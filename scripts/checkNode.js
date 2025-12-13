const [major] = process.versions.node.split(".").map(Number);

if (Number.isNaN(major) || major < 20) {
  console.error(
    `ERROR: Node.js ${process.versions.node} is not supported.\n` +
    `Please use Node >= 20 (e.g., via nvm).`
  );
  process.exit(1);
}
