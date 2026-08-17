const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = [];

function walk(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.name.endsWith(".js") && !fullPath.includes(`${path.sep}vendor${path.sep}`)) files.push(fullPath);
  });
}

["js", "src", "tests"].forEach((directory) => walk(path.join(root, directory)));
files.forEach((file) => new vm.Script(fs.readFileSync(file, "utf8"), { filename: path.relative(root, file) }));
console.log(`JavaScript syntax sweep: ${files.length} files passed`);
