const fs = require('fs');
const path = require('path');

// Read the text file
const filePath = 'C:/Users/mdedu/Downloads/New Text Document (4).txt';
const content = fs.readFileSync(filePath, 'utf8');

// Regex to find lines with prices
// Format: * Product Name: Price টাকা (Link: ...)
// Or just: * Product Name: Price টাকা
const regex = /\*\s+([^*]+?):\s*([\d\.]+(?:৳| টাকা))/g;

let match;
let count = 0;
console.log("--- Products Found ---");

while ((match = regex.exec(content)) !== null) {
    const name = match[1].trim();
    const price = match[2].trim();
    console.log(`${count + 1}. ${name} - ${price}`);
    count++;
}

console.log(`\nTotal Products Found: ${count}`);
