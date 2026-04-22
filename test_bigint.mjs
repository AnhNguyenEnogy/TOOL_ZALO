// Test BigInt precision
const bigId = "8562793226094924289";
const num = Number(bigId);
console.log("Original:      ", bigId);
console.log("As JS Number:  ", num);
console.log("Back to String:", String(num));
console.log("Match:         ", bigId === String(num) ? "YES ✅" : "NO ❌ (CORRUPTED!)");
console.log("Diff:          ", BigInt(bigId) - BigInt(String(num)));
