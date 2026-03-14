const fs = require('fs');
const path = require('path');

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function hasUtf8Bom(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

function stripBomFiles(tasksDir) {
  const files = fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort(compareStrings);

  let fixed = 0;
  let unchanged = 0;

  for (const fileName of files) {
    const absolutePath = path.join(tasksDir, fileName);
    const bytes = fs.readFileSync(absolutePath);
    if (hasUtf8Bom(bytes)) {
      fs.writeFileSync(absolutePath, bytes.slice(3));
      fixed += 1;
    } else {
      unchanged += 1;
    }
  }

  process.stdout.write(`BOM_STRIP_SUMMARY fixed=${fixed} unchanged=${unchanged}\n`);
}

function main() {
  const root = path.resolve(__dirname, '../../..');
  const tasksDir = path.join(root, 'bench', 'tasks');
  stripBomFiles(tasksDir);
}

if (require.main === module) {
  main();
}

module.exports = {
  compareStrings,
  stripBomFiles,
};
