import { MemorySystem } from "@nextain/naia-memory"; // Assuming MemorySystem is exported from the library
import cors from "cors";
import express from "express";

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize the memory instance (this might need more sophisticated setup)
const memory = new MemorySystem({}); // Placeholder, actual initialization might vary

app.get("/", (req, res) => {
	res.send("Naia Memory Service is running!");
});

// Example endpoint: search memory
app.post("/search", async (req, res) => {
	try {
		const { query } = req.body;
		if (!query) {
			return res.status(400).json({ error: "Query is required" });
		}
		// Assuming 'search' method exists and returns relevant data
		const results = await memory.search(query);
		res.json(results);
	} catch (error) {
		console.error("Error during memory search:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// Add other memory-related endpoints as needed (e.g., add, update, delete)

app.listen(port, () => {
	console.log(`Naia Memory Service listening at http://localhost:${port}`);
});
