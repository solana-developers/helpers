import { promises as fs } from 'fs';
import path from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CJS_DIR = path.join(__dirname, 'dist', 'cjs');
const ESM_DIR = path.join(__dirname, 'dist', 'esm');

async function createPackageJson(dir, type) {
  const content = JSON.stringify({ type }, null, 2);
  await fs.writeFile(path.join(dir, 'package.json'), content);
  console.log(`Created package.json in ${dir}`);
}

async function renameIndexFile() {
  const oldPath = path.join(CJS_DIR, 'index.js');
  const newPath = path.join(CJS_DIR, 'index.cjs');
  await fs.rename(oldPath, newPath);
  console.log('Renamed CJS index file to index.cjs');
}

async function processEsmFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await processEsmFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        let content = await fs.readFile(fullPath, 'utf8');
        
        // Add .js extension to import statements
        content = content.replace(/from\s+['"](\.[^'"]+)['"]/g, "from '$1.js'");
        
        // Add .js extension to export statements
        content = content.replace(/export\s+\*\s+from\s+['"](\.[^'"]+)['"]/g, "export * from '$1.js'");
        
        await fs.writeFile(fullPath, content);
        console.log(`Processed ESM file: ${fullPath}`);
      }
    }
  }

async function postbuild() {
  try {
    // Create package.json files
    await createPackageJson(CJS_DIR, 'commonjs');
    await createPackageJson(ESM_DIR, 'module');

    // Rename index.js to index.cjs in CJS directory
    await renameIndexFile();

    // Process ESM files to add .js extensions
    await processEsmFiles(ESM_DIR);

    console.log('Postbuild completed successfully!');
  } catch (error) {
    console.error('Postbuild failed:', error);
    process.exit(1);
  }
}

postbuild();