const express = require("express");
const WebSocket = require("ws");
const axios = require("axios");
const path = require("path");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = 3000;

// Serve the HTML file
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "index.html"));
});

// Function to fetch historical data for different intervals
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
		return [];
	}
}

// Helper function to format data for candlestick chart
function formatData(data) {
	return data.map((entry) => ({
		x: new Date(entry[0]).toISOString(),
		o: parseFloat(entry[1]),
		h: parseFloat(entry[2]),
		l: parseFloat(entry[3]),
		c: parseFloat(entry[4]),
	}));
}

// WebSocket connection with Binance for real-time price data
function connectToBinanceWebSocket(symbol, wsClient) {
	const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
	const promises = intervals.map((interval) => getBinanceData(symbol, interval, 200));

	Promise.all(promises).then((results) => {
		const [minute1Data, minute5Data, minute15Data, hour1Data, hour4Data, dailyData] = results;

		const formattedData = {
			"1m": formatData(minute1Data),
			"5m": formatData(minute5Data),
			"15m": formatData(minute15Data),
			"1h": formatData(hour1Data),
			"4h": formatData(hour4Data),
			"1d": formatData(dailyData),
		};

		// Send the historical data to the client
		wsClient.send(JSON.stringify(formattedData));

		// Start real-time WebSocket stream from Binance (1-minute intervals)
		const binanceSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1m`);

		// Handle real-time price data
		binanceSocket.on("message", (data) => {
			const message = JSON.parse(data);
			const candle = message.k;

			// Format the real-time data
			const realTimeData = {
				x: new Date(candle.t).toISOString(),
				o: parseFloat(candle.o),
				h: parseFloat(candle.h),
				l: parseFloat(candle.l),
				c: parseFloat(candle.c),
			};

			// Send real-time data to the client
			wsClient.send(JSON.stringify({ realTimeUpdate: realTimeData }));
		});

		binanceSocket.on("close", () => {
			console.log(`Binance WebSocket closed for ${symbol}`);
		});
	});
}

// WebSocket server to listen to frontend
wss.on("connection", (ws, req) => {
	const params = new URLSearchParams(req.url.replace("/ws?", ""));
	const symbol = params.get("symbol");

	if (symbol) {
		connectToBinanceWebSocket(symbol, ws);
	}

	ws.on("close", () => {
		console.log("Client disconnected");
	});
});

// Start the server
server.listen(port, () => {
	console.log(`Server running at http://localhost:${port}`);
});
