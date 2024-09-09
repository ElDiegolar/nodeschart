const express = require("express");
const WebSocket = require("ws");
const axios = require("axios");
const path = require("path");
const http = require("http");
const fs = require("fs");
const dotenv = require("dotenv");
const OpenAI = require("openai"); // Updated import for OpenAI

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY || "1yQxAj9xyn4owZyo4GI3Pai3uwPgbUva";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Configure OpenAI using the updated `openai` module
const openai = new OpenAI({
	apiKey: OPENAI_API_KEY,
});

// Rate limiting variables
const MAX_REQUESTS_PER_MINUTE = 5;
const requests = new Map();

// Serve the HTML file
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "fxTradingFE.html"));
});

// Helper function to format date to YYYY-MM-DD
function formatDate(date) {
	return date.toISOString().split("T")[0];
}

// Function to check and update rate limit
function checkRateLimit(symbol) {
	const now = Date.now();
	const windowStart = now - 60000; // 1 minute ago

	if (!requests.has(symbol)) {
		requests.set(symbol, []);
	}

	const symbolRequests = requests.get(symbol);
	const recentRequests = symbolRequests.filter((time) => time > windowStart);

	if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
		return false;
	}

	recentRequests.push(now);
	requests.set(symbol, recentRequests);
	return true;
}

// Function to fetch historical data using Polygon.io API
async function getMarketData(symbol, interval = "day", from, to) {
	if (!checkRateLimit(symbol)) {
		throw new Error("Rate limit exceeded. Please try again later.");
	}

	try {
		const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/${interval}/${from}/${to}?apiKey=${POLYGON_API_KEY}`;
		const response = await axios.get(url);
		return response.data.results || [];
	} catch (error) {
		if (error.response && error.response.status === 429) {
			throw new Error("Polygon API rate limit exceeded. Please try again later.");
		}
		throw error;
	}
}

// Helper function to format data for candlestick chart
function formatData(data) {
	return data.map((entry) => ({
		x: new Date(entry.t).toISOString(),
		o: entry.o,
		h: entry.h,
		l: entry.l,
		c: entry.c,
	}));
}

// Function to get market signal from ChatGPT using GPT-4
async function getMarketSignal(marketData, seedInfo) {
	try {
		const prompt = `
Based on the following market data and additional information, provide a brief market signal (bullish, bearish, or neutral) with a short explanation with the entry or exit play.

Market Data:
${JSON.stringify(marketData, null, 2)}

Additional Information:
${seedInfo}

Please provide your analysis in the following format:
Pair: [Current Pair here]
Signal: [Your signal here (bullish/bearish/neutral)]
Explanation: [Your brief explanation here]
Entry Price: [Entry Price here]
`;

		const response = await openai.chat.completions.create({
			model: "gpt-4o",
			messages: [
				{
					role: "system",
					content: "You are a trading assistant who helps traders analyze market data and provide trading signals.",
				},
				{
					role: "user",
					content: prompt,
				},
			],
			max_tokens: 150,
			temperature: 0.7,
		});

		return response.choices[0].message.content.trim();
	} catch (error) {
		console.error("Error getting market signal from ChatGPT:", error);
		return "Error: Unable to generate market signal.";
	}
}

// WebSocket connection for market data
async function connectToMarketWebSocket(symbol, wsClient, seedInfo) {
	const intervals = ["day", "week", "month"];
	const endDate = new Date();
	const startDate = new Date();
	startDate.setFullYear(endDate.getFullYear() - 1); // Get 1 year of historical data

	const from = formatDate(startDate);
	const to = formatDate(endDate);

	try {
		const results = await Promise.all(intervals.map((interval) => getMarketData(symbol, interval, from, to)));

		const formattedData = {};
		intervals.forEach((interval, index) => {
			formattedData[interval] = formatData(results[index]);
		});

		// Get market signal from ChatGPT
		const marketSignal = await getMarketSignal(formattedData, seedInfo);

		// Send the historical data and market signal to the client
		wsClient.send(JSON.stringify({ ...formattedData, marketSignal }));
		fs.writeFile("Signaldata.txt", marketSignal, (err) => {
			if (err) {
				console.error(`Error writing to file: ${err}`);
			} else {
				console.log("Successfully written to file");
			}
		});
		// Simulate real-time updates
		const updateInterval = setInterval(async () => {
			try {
				const today = formatDate(new Date());
				const recentData = await getMarketData(symbol, "day", today, today);
				const realTimeData = formatData(recentData);

				// Get updated market signal
				const updatedMarketSignal = await getMarketSignal({ day: realTimeData }, seedInfo);

				// Send real-time data and updated market signal to the client
				wsClient.send(JSON.stringify({ realTimeUpdate: realTimeData[0], marketSignal: updatedMarketSignal }));
			} catch (error) {
				console.error("Error fetching real-time data:", error.message);
				wsClient.send(JSON.stringify({ error: error.message }));
			}
		}, 60000); // Simulate a 1-minute update interval

		wsClient.on("close", () => {
			clearInterval(updateInterval);
		});
	} catch (error) {
		console.error("Error fetching initial data:", error.message);
		wsClient.send(JSON.stringify({ error: error.message }));
	}
}

// WebSocket server to listen to frontend
wss.on("connection", (ws, req) => {
	const params = new URLSearchParams(req.url.replace("/ws?", ""));
	const symbol = params.get("symbol");

	// Read seed information from a text file
	const seedFilePath = path.join(__dirname, "seedInfo.txt");

	// Asynchronously read the file content
	fs.readFile(seedFilePath, "utf8", (err, seedInfo) => {
		if (err) {
			console.error("Error reading seed info file:", err);
			seedInfo = "Error reading seed info. Default seed info will be used.";
		}

		// Use the seed information, or default if not found
		if (!symbol) {
			ws.send(JSON.stringify({ error: "Symbol not provided." }));
			return;
		}

		// Connect to market WebSocket with seed information and symbol
		connectToMarketWebSocket(symbol, ws, seedInfo);

		// Log connection closure
		ws.on("close", () => {
			console.log("Client disconnected");
		});
	});
});

// Start the server
server.listen(port, () => {
	console.log(`Server running at http://localhost:${port}`);
	console.log(`Polygon API Key ${POLYGON_API_KEY ? "is" : "is not"} set`);
	console.log(`OpenAI API Key ${OPENAI_API_KEY ? "is" : "is not"} set`);
});
