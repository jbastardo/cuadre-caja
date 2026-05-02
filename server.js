// Minimal startup logger - runs before anything else
console.log("========================================");
console.log("SERVER.JS STARTED SUCCESSFULLY");
console.log("Node:", process.version);
console.log("PORT env:", process.env.PORT);
console.log("DATABASE_URL set:", !!process.env.DATABASE_URL);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("CWD:", process.cwd());
console.log("========================================");

// Now load the real app
import("./dist/index.js");