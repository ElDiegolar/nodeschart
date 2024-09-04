const express = require("express");
const axios = require("axios");
const path = require("path");
const app = express();
const port = 3000;

// Function to fetch data from Binance for a specific interval
async function getBinanceData(symbol, interval, limit) {
	try {
		const response = await axios.get("https://api.binance.com/api/v3/klines", {
			params: {
				symbol: symbol,
				interval: interval,
				limit: limit,
			},
		});
		return response.data;
	} catch (error) {
		console.error(error);
		return null;
	}
}

// Helper function to calculate Simple Moving Averages
function calculateSMA(data, period) {
	const sma = [];
	for (let i = period - 1; i < data.length; i++) {
		const sum = data.slice(i + 1 - period, i + 1).reduce((acc, val) => acc + parseFloat(val[4]), 0);
		sma.push({
			x: new Date(data[i][0]).toISOString(),
			y: sum / period,
		});
	}
	return sma;
}

// Helper function to calculate MACD
function calculateMACD(data, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
	const macdLine = [];
	const signalLine = [];
	const histogram = [];

	let shortEMA = 0;
	let longEMA = 0;

	for (let i = 0; i < data.length; i++) {
		const close = parseFloat(data[i][4]);

		shortEMA = i === 0 ? close : (close - shortEMA) * (2 / (shortPeriod + 1)) + shortEMA;
		longEMA = i === 0 ? close : (close - longEMA) * (2 / (longPeriod + 1)) + longEMA;

		const macdValue = shortEMA - longEMA;
		macdLine.push({ x: new Date(data[i][0]).toISOString(), y: macdValue });

		if (i >= longPeriod - 1) {
			const signalEMA = i === longPeriod - 1 ? macdValue : (macdValue - signalLine[signalLine.length - 1].y) * (2 / (signalPeriod + 1)) + signalLine[signalLine.length - 1].y;
			signalLine.push({ x: new Date(data[i][0]).toISOString(), y: signalEMA });
			histogram.push({ x: new Date(data[i][0]).toISOString(), y: macdValue - signalEMA });
		} else {
			signalLine.push({ x: new Date(data[i][0]).toISOString(), y: 0 });
			histogram.push({ x: new Date(data[i][0]).toISOString(), y: 0 });
		}
	}

	return { macdLine, signalLine, histogram, longPeriod };
}

async function prepareChartData() {
	const symbol = "XRPUSDT";
	const limit = 200;

	// Fetch data for 1d, 4h, and 1h intervals
	const [dayData, hour4Data, hour1Data] = await Promise.all([
		getBinanceData(symbol, "1d", limit),
		getBinanceData(symbol, "4h", limit * 6), // 6 * 4h = 1d
		getBinanceData(symbol, "1h", limit * 24), // 24 * 1h = 1d
	]);

	if (!dayData || !hour4Data || !hour1Data) return null;

	const labels = dayData.map((entry) => new Date(entry[0]).toISOString());
	const prices = dayData.map((entry) => parseFloat(entry[4])); // Close price

	const sma50 = calculateSMA(dayData, 50);
	const sma200 = calculateSMA(dayData, 200);
	const { macdLine, signalLine, histogram, longPeriod } = calculateMACD(dayData);

	// Process 4-hour and 1-hour data
	const hour4Prices = hour4Data.map((entry) => ({
		x: new Date(entry[0]).toISOString(),
		y: parseFloat(entry[4]),
	}));

	const hour1Prices = hour1Data.map((entry) => ({
		x: new Date(entry[0]).toISOString(),
		y: parseFloat(entry[4]),
	}));

	// Ensure all data starts at the same point (after enough data for longPeriod)
	const startIndex = longPeriod - 1;

	return {
		labels: labels.slice(startIndex),
		prices: prices.slice(startIndex),
		sma50: sma50.slice(startIndex),
		sma200: sma200.slice(startIndex),
		macdLine: macdLine.slice(startIndex),
		signalLine: signalLine.slice(startIndex),
		histogram: histogram.slice(startIndex),
		hour4Prices: hour4Prices.slice(hour4Prices.length - (labels.length - startIndex)),
		hour1Prices: hour1Prices.slice(hour1Prices.length - (labels.length - startIndex)),
	};
}

// Serve the HTML file
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "index.html"));
});

// API endpoint to get chart data
app.get("/data", async (req, res) => {
	const chartData = await prepareChartData();
	res.json(chartData);
});

// Start the server
app.listen(port, () => {
	console.log(`Server running at http://localhost:${port}`);
});
