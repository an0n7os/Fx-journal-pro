const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf-8');
const regex = /<<<<<<< HEAD[\s\S]*?=======\r?\n([\s\S]*?)>>>>>>> achivements\r?\n?/g;
content = content.replace(regex, '$1');
fs.writeFileSync('src/App.tsx', content);
console.log('Done resolving');
