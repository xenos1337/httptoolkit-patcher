// @ts-check
import { spawn, execSync } from "child_process";
import asar from "@electron/asar";
import chalk from "chalk";
import path from "path";
import fs from "fs";
import readline from "readline";
import https from "https";
import { fileURLToPath } from "url";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

// Handle both ESM and pkg-bundled scenarios
const __filename = (() => {
	// Check if running as pkg bundle
	// @ts-ignore - pkg adds this property at runtime
	if (process.pkg) {
		return process.execPath;
	}
	// ESM: use import.meta.url
	return fileURLToPath(import.meta.url);
})();

// Version info - read from package.json
const GITHUB_REPO = "xenos1337/httptoolkit-patcher";
const LOCAL_VERSION = (() => {
	try {
		const packageJsonPath = path.join(path.dirname(__filename), "package.json");
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
		return packageJson.version || "0.0.0";
	} catch {
		return "0.0.0";
	}
})();

// Check if running with elevated privileges
function isElevated() {
	if (isWin) {
		try {
			execSync("net session", { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	} else {
		return process.getuid && process.getuid() === 0;
	}
}

// Helper function to prompt user for input
function prompt(question) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	return new Promise(resolve => {
		rl.question(question, answer => {
			rl.close();
			resolve(answer);
		});
	});
}

/**
 * Fetch JSON from a URL
 * @param {string} url
 * @returns {Promise<Array<{name: string}>>}
 */
function fetchJson(url) {
	return new Promise((resolve, reject) => {
		const options = {
			headers: {
				"User-Agent": "httptoolkit-patcher",
				Accept: "application/vnd.github.v3+json",
			},
		};
		https
			.get(url, options, res => {
				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode}`));
					return;
				}
				let data = "";
				res.on("data", chunk => (data += chunk));
				res.on("end", () => {
					try {
						resolve(JSON.parse(data));
					} catch (e) {
						reject(e);
					}
				});
			})
			.on("error", reject);
	});
}

function compareVersions(v1, v2) {
	const normalize = (/** @type {string} */ v) => v.replace(/^v/, "").split(".").map(Number);
	const parts1 = normalize(v1);
	const parts2 = normalize(v2);

	for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
		const num1 = parts1[i] || 0;
		const num2 = parts2[i] || 0;
		if (num1 > num2) return 1;
		if (num1 < num2) return -1;
	}
	return 0;
}

/**
 * Check for updates from GitHub
 */
async function checkForUpdates() {
	try {
		const tags = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/tags`);

		if (!tags || tags.length === 0) {
			return; // No tags found, skip update check
		}

		// Tags are returned in order, first one is the latest
		const latestTag = tags[0].name;
		const latestVersion = latestTag.replace(/^v/, "");

		if (compareVersions(latestVersion, LOCAL_VERSION) > 0) {
			console.log(chalk.yellowBright`\n╔════════════════════════════════════════════════════════════╗`);
			console.log(chalk.yellowBright`║` + chalk.white`   A new version is available: ` + chalk.greenBright`v${latestVersion}` + chalk.white` (current: ` + chalk.gray`v${LOCAL_VERSION}` + chalk.white`)  ` + chalk.yellowBright`  ║`);
			console.log(chalk.yellowBright`║` + chalk.white`  Update: ` + chalk.cyanBright`https://github.com/${GITHUB_REPO}` + chalk.white`  ` + chalk.yellowBright`║`);
			console.log(chalk.yellowBright`╚════════════════════════════════════════════════════════════╝\n`);
		}
	} catch (e) {
		// Silently ignore update check errors (network issues, etc.)
	}
}

// Helper function to remove directory recursively
function rm(dirPath) {
	if (!fs.existsSync(dirPath)) return;
	if (!fs.lstatSync(dirPath).isDirectory()) return fs.rmSync(dirPath, { force: true });
	for (const entry of fs.readdirSync(dirPath)) {
		const entryPath = path.join(dirPath, entry);
		if (fs.lstatSync(entryPath).isDirectory()) rm(entryPath);
		else fs.rmSync(entryPath, { force: true });
	}
	fs.rmdirSync(dirPath);
}

// Find HTTP Toolkit installation path
async function findAppPath() {
	const possiblePaths = isWin
		? [path.join("C:", "Program Files", "HTTP Toolkit", "resources"), path.join("C:", "Program Files (x86)", "HTTP Toolkit", "resources"), path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"), "Programs", "HTTP Toolkit", "resources")]
		: isMac
		? ["/Applications/HTTP Toolkit.app/Contents/Resources"]
		: ["/opt/HTTP Toolkit/resources", "/opt/httptoolkit/resources"];

	for (const p of possiblePaths) {
		if (fs.existsSync(path.join(p, "app.asar"))) {
			return p;
		}
	}

	console.log(chalk.yellowBright`[!] HTTP Toolkit not found in default locations`);
	const userPath = await prompt("Please enter the path to HTTP Toolkit executable/app: ");

	if (!userPath) {
		console.error(chalk.redBright`[-] No path provided`);
		process.exit(1);
	}

	// Extract resources path from user input
	let resourcesPath = userPath.trim().replace(/['"]/g, "");

	if (resourcesPath.endsWith(".exe") || resourcesPath.endsWith(".app")) resourcesPath = path.dirname(resourcesPath);
	if (!resourcesPath.endsWith("resources")) resourcesPath = path.join(resourcesPath, "resources");

	if (!fs.existsSync(path.join(resourcesPath, "app.asar"))) {
		console.error(chalk.redBright`[-] app.asar not found at ${resourcesPath}`);
		process.exit(1);
	}

	return resourcesPath;
}

// Request elevated permissions
async function requestElevation() {
	console.log(chalk.yellowBright`[!] Requesting elevated permissions...`);

	// @ts-ignore - pkg adds this property at runtime
	const isBundled = process.pkg;

	if (isWin) {
		// Windows: Use PowerShell to run as administrator
		let script;
		if (isBundled) {
			script = `Start-Process -FilePath "${__filename}" -Verb RunAs`;
		} else {
			script = `Start-Process -FilePath "node" -ArgumentList "${__filename}" -Verb RunAs`;
		}

		try {
			console.log(chalk.greenBright`[+] Spawning PowerShell with script: ${script}`);
			execSync(`powershell -Command "${script}"`, { stdio: "inherit" });
			console.log(chalk.blueBright`[+] Restarting with administrator privileges...`);
			process.exit(0);
		} catch (e) {
			console.error(chalk.redBright`[-] Failed to elevate permissions: ${e.message}`);
			console.error(chalk.redBright`[-] Please run as administrator manually`);
			process.exit(1);
		}
	} else if (isLinux) {
		// Linux: Cannot auto-elevate with sudo, show instructions instead
		console.log(chalk.yellowBright`[!] Elevated permissions are required for patching on Linux`);
		console.log(chalk.yellowBright`[!] Please re-run this script with sudo:`);
		if (isBundled) {
			console.log(chalk.blueBright`    sudo ${__filename}`);
		} else {
			console.log(chalk.blueBright`    sudo node ${__filename}`);
		}
		process.exit(1);
	} else {
		// macOS: Try to elevate with sudo
		console.log(chalk.blueBright`[+] Restarting with sudo...`);
		try {
			let child;
			if (isBundled) {
				child = spawn("sudo", [__filename], {
					stdio: "inherit",
				});
			} else {
				child = spawn("sudo", ["node", __filename], {
					stdio: "inherit",
				});
			}
			child.on("exit", code => process.exit(code || 0));
		} catch (e) {
			console.error(chalk.redBright`[-] Failed to elevate permissions: ${e.message}`);
			console.error(chalk.redBright`[-] Please run with sudo manually`);
			process.exit(1);
		}
	}
}

// Check if we have write permissions
function checkPermissions(filePath) {
	try {
		// Check write access to the file/directory
		fs.accessSync(filePath, fs.constants.W_OK);

		// Check if we can create directories
		const testDirPath = path.join(path.dirname(filePath), `.test_${Date.now()}`);
		try {
			fs.mkdirSync(testDirPath, { recursive: true });
			fs.rmdirSync(testDirPath);
		} catch (dirError) {
			console.error(chalk.redBright`[-] Cannot create directories in ${path.dirname(filePath)}: ${dirError.message}`);
			return false;
		}

		console.log(chalk.greenBright`[+] Permissions check passed for ${filePath}`);
		return true;
	} catch (e) {
		console.error(chalk.redBright`[-] Permissions check failed for ${filePath}: ${e.message}`);
		return false;
	}
}

// Kill HTTP Toolkit processes
async function killHttpToolkit() {
	console.log(chalk.yellowBright`[+] Checking for running HTTP Toolkit processes...`);

	try {
		if (isWin) {
			// Windows: Use tasklist to find and taskkill to terminate
			const output = execSync('tasklist /FI "IMAGENAME eq HTTP Toolkit.exe" /FO CSV /NH', { encoding: "utf-8" });
			if (output.includes("HTTP Toolkit.exe")) {
				console.log(chalk.yellowBright`[!] HTTP Toolkit is running, attempting to close it...`);
				execSync('taskkill /F /IM "HTTP Toolkit.exe" /T', { stdio: "ignore" });
				console.log(chalk.greenBright`[+] HTTP Toolkit processes terminated`);
				// Wait a moment for the process to fully close
				await new Promise(resolve => setTimeout(resolve, 2000));
			} else {
				console.log(chalk.greenBright`[+] HTTP Toolkit is not running`);
			}
		} else if (isMac) {
			// macOS: Use pgrep and pkill
			try {
				execSync('pgrep -f "HTTP Toolkit"', { stdio: "ignore" });
				console.log(chalk.yellowBright`[!] HTTP Toolkit is running, attempting to close it...`);
				execSync('pkill -f "HTTP Toolkit"', { stdio: "ignore" });
				console.log(chalk.greenBright`[+] HTTP Toolkit processes terminated`);
				await new Promise(resolve => setTimeout(resolve, 2000));
			} catch (e) {
				console.log(chalk.greenBright`[+] HTTP Toolkit is not running`);
			}
		} else {
			// Linux: Use pgrep and pkill
			try {
				execSync('pgrep -f "HTTP Toolkit"', { stdio: "ignore" });
				console.log(chalk.yellowBright`[!] HTTP Toolkit is running, attempting to close it...`);
				execSync('pkill -f "HTTP Toolkit"', { stdio: "ignore" });
				console.log(chalk.greenBright`[+] HTTP Toolkit processes terminated`);
				await new Promise(resolve => setTimeout(resolve, 2000));
			} catch (e) {
				console.log(chalk.greenBright`[+] HTTP Toolkit is not running`);
			}
		}
	} catch (e) {
		console.log(chalk.yellowBright`[!] Could not check/kill processes: ${e.message}`);
		console.log(chalk.yellowBright`[!] If HTTP Toolkit is running, please close it manually`);
	}
}

// Resolve the base installation directory (without the trailing resources folder)
function getBinaryBasePath(resourcesPath) {
	const normalized = resourcesPath.replace(/[\\/]+$/, "");
	if (normalized.toLowerCase().endsWith("resources")) {
		return path.dirname(normalized);
	}
	return normalized;
}

// Determine the executable path for HTTP Toolkit based on platform
function getExecutablePath(resourcesPath) {
	const basePath = getBinaryBasePath(resourcesPath);
	const candidates = isWin ? [path.join(basePath, "HTTP Toolkit.exe"), path.join(basePath, "httptoolkit.exe")] : isMac ? [path.join(basePath, "MacOS", "HTTP Toolkit"), path.join(basePath, "MacOS", "HTTP Toolkit Preview")] : [path.join(basePath, "httptoolkit"), path.join(basePath, "HTTP Toolkit")];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(`Could not locate HTTP Toolkit executable near ${resourcesPath}`);
}

// Extract hashes from integrity check output
function extractIntegrityHashes(output) {
	const regex = /Integrity check failed for asar archive[\s\S]*?\(\s*([0-9a-f]{64})\s*vs\s*([0-9a-f]{64})\s*\)/i;
	const match = output.match(regex);
	if (!match) return null;
	return {
		originalHash: match[1],
		newHash: match[2],
	};
}

// Launch the app once to grab integrity hashes from its crash output
async function captureIntegrityHashes(executablePath) {
	return new Promise((resolve, reject) => {
		let output = "";
		let finished = false;
		const child = spawn(executablePath, {
			cwd: path.dirname(executablePath),
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		const timeout = setTimeout(() => {
			if (!finished) {
				finished = true;
				child.kill();
				reject(new Error("Timed out waiting for integrity check output"));
			}
		}, 20000);

		const handleData = data => {
			output += data.toString();
			const hashes = extractIntegrityHashes(output);
			if (hashes && !finished) {
				finished = true;
				clearTimeout(timeout);
				child.kill();
				resolve(hashes);
			}
		};

		child.stdout.on("data", handleData);
		child.stderr.on("data", handleData);

		child.on("error", err => {
			if (!finished) {
				finished = true;
				clearTimeout(timeout);
				reject(err);
			}
		});

		child.on("exit", () => {
			if (!finished) {
				clearTimeout(timeout);
				const hashes = extractIntegrityHashes(output);
				if (hashes) {
					resolve(hashes);
				} else {
					reject(new Error("Could not find integrity hashes in HTTP Toolkit output"));
				}
			}
		});
	});
}

// Replace all occurrences of the original hash with the new hash inside the binary
function patchExecutableHash(executablePath, originalHash, newHash) {
	if (originalHash.length !== newHash.length) {
		throw new Error("Hash lengths do not match; cannot safely patch binary");
	}

	const binary = fs.readFileSync(executablePath);
	const originalBuf = Buffer.from(originalHash, "utf-8");
	const newBuf = Buffer.from(newHash, "utf-8");

	let occurrences = 0;
	let idx = binary.indexOf(originalBuf);
	while (idx !== -1) {
		newBuf.copy(binary, idx);
		occurrences += 1;
		idx = binary.indexOf(originalBuf, idx + originalBuf.length);
	}

	if (occurrences === 0) {
		throw new Error("Original hash not found in binary");
	}

	fs.writeFileSync(executablePath, binary);
	return occurrences;
}

// Unpatch/restore function
async function unpatchApp() {
	console.log(chalk.blueBright`[+] HTTP Toolkit Unpatcher Started`);

	const appPath = await findAppPath();
	console.log(chalk.greenBright`[+] HTTP Toolkit found at ${appPath}`);

	await killHttpToolkit();

	const asarPath = path.join(appPath, "app.asar");
	const backupPath = path.join(appPath, "app.asar.bak");
	const extractPath = path.join(appPath, "app.asar_extracted");

	// Check if we have write permissions on both the directory and the file
	const hasPermissions = checkPermissions(appPath) && checkPermissions(asarPath);

	if (!hasPermissions) {
		console.log(chalk.yellowBright`[!] No write permissions for ${appPath}`);

		if (isElevated()) {
			console.error(chalk.redBright`[-] Still no permissions even with elevated privileges`);
			process.exit(1);
		}

		console.log(chalk.yellowBright`[!] Administrator/sudo privileges required for unpatching`);
		await requestElevation();
	}

	if (!fs.existsSync(backupPath)) {
		console.error(chalk.redBright`[-] Backup file not found at ${backupPath}`);
		console.error(chalk.redBright`[-] Cannot unpatch without backup file`);
		process.exit(1);
	}

	console.log(chalk.yellowBright`[+] Restoring from backup...`);
	try {
		fs.copyFileSync(backupPath, asarPath);
		console.log(chalk.greenBright`[+] Restored app.asar from backup`);
	} catch (e) {
		console.error(chalk.redBright`[-] Failed to restore backup: ${e.message}`);
		process.exit(1);
	}

	if (fs.existsSync(extractPath)) {
		console.log(chalk.yellowBright`[+] Removing extracted files...`);
		rm(extractPath);
		console.log(chalk.greenBright`[+] Cleaned up extracted files`);
	}

	const removeBackup = await prompt("Do you want to remove the backup file? (y/n): ");
	if (removeBackup.toLowerCase() === "y" || removeBackup.toLowerCase() === "yes") {
		fs.rmSync(backupPath, { force: true });
		console.log(chalk.greenBright`[+] Backup file removed`);
	}

	console.log(chalk.greenBright`[+] Successfully unpatched!`);
}

// Main patching function
async function patchApp() {
	console.log(chalk.blueBright`[+] HTTP Toolkit Patcher Started`);

	const appPath = await findAppPath();
	console.log(chalk.greenBright`[+] HTTP Toolkit found at ${appPath}`);

	await killHttpToolkit();

	const asarPath = path.join(appPath, "app.asar");

	// Check if we have write permissions on both the directory and the file
	const hasPermissions = checkPermissions(appPath) && checkPermissions(asarPath);

	if (!hasPermissions) {
		console.log(chalk.yellowBright`[!] No write permissions for ${appPath}`);

		if (isElevated()) {
			console.error(chalk.redBright`[-] Still no permissions even with elevated privileges`);
			process.exit(1);
		}

		console.log(chalk.yellowBright`[!] Administrator/sudo privileges required for patching`);
		await requestElevation();
	}

	const backupPath = path.join(appPath, "app.asar.bak");
	if (!fs.existsSync(backupPath)) {
		console.log(chalk.yellowBright`[+] Creating backup...`);
		fs.copyFileSync(asarPath, backupPath);
		console.log(chalk.greenBright`[+] Backup created at ${backupPath}`);
	}

	const extractPath = path.join(appPath, "app.asar_extracted");
	console.log(chalk.yellowBright`[+] Extracting app.asar...`);
	rm(extractPath);
	asar.extractAll(asarPath, extractPath);
	console.log(chalk.greenBright`[+] Extracted to ${extractPath}`);

	const preloadPath = path.join(extractPath, "build", "preload.cjs");
	if (!fs.existsSync(preloadPath)) {
		console.error(chalk.redBright`[-] preload.cjs not found in ${path.join(extractPath, "build")}`);
		console.error(chalk.yellowBright`[!] Please download the latest version of HTTP Toolkit from https://httptoolkit.com/`);
		rm(extractPath);
		process.exit(1);
	}
	console.log(chalk.greenBright`[+] Found preload.cjs`);

	console.log(chalk.yellowBright`[+] Reading inject code from local file...`);
	const injectJsPath = path.join(path.dirname(__filename), "inject.js");
	if (!fs.existsSync(injectJsPath)) {
		console.error(chalk.redBright`[-] inject.js not found at ${injectJsPath}`);
		rm(extractPath);
		process.exit(1);
	}
	const injectCode = fs.readFileSync(injectJsPath, "utf-8");
	if (!injectCode || !injectCode.includes("PAGE-INJECT")) {
		console.error(chalk.redBright`[-] Invalid inject.js file`);
		rm(extractPath);
		process.exit(1);
	}
	console.log(chalk.greenBright`[+] Inject code loaded successfully`);

	let preloadContent = fs.readFileSync(preloadPath, "utf-8");

	const electronVarName = preloadContent.includes("electron_1") ? "electron_1" : "electron";
	console.log(chalk.greenBright`[+] Detected electron variable: ${electronVarName}`);

	const preloadPatchCode = `
(function loadInjectScript() {
	const injectCode = ${JSON.stringify(injectCode)};
	
	function injectViaWebFrame() {
		try {
			const { webFrame } = ${electronVarName};
			if (webFrame && webFrame.executeJavaScript) {
				webFrame.executeJavaScript(injectCode).then(() => console.log("[PRELOAD] Injected via webFrame.executeJavaScript")).catch(err => console.error("[PRELOAD] webFrame injection failed:", err));
				return true;
			}
		} catch (e) {
			console.error("[PRELOAD] webFrame not available:", e);
		}
		return false;
	}
	
	if (!injectViaWebFrame()) {
		const tryInject = () => {
			if (!injectViaWebFrame()) {
				console.error("[PRELOAD] All injection methods failed");
			}
		};
		
		if (document.readyState === 'complete' || document.readyState === 'interactive') {
			tryInject();
		} else {
			document.addEventListener('DOMContentLoaded', tryInject, { once: true });
		}
	}
})();
`;
	const isPreloadPatched = preloadContent.includes("loadInjectScript");

	if (isPreloadPatched) {
		console.log(chalk.yellowBright`[!] Files already patched`);
		const answer = await prompt("Do you want to repatch? (y/n): ");

		if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
			console.log(chalk.blueBright`[+] Patching cancelled`);
			rm(extractPath);
			process.exit(0);
		}

		// Remove existing patches
		console.log(chalk.yellowBright`[+] Replacing existing patches...`);

		// Remove preload patch
		const preloadPatchRegex = /\n?\(function loadInjectScript\(\) \{[\s\S]*?\}\)\(\);/;
		preloadContent = preloadContent.replace(preloadPatchRegex, "");
	}

	console.log(chalk.yellowBright`[+] Applying preload patch...`);
	const preloadLines = preloadContent.split("\n");
	let preloadInsertIndex = -1;

	for (let i = 0; i < preloadLines.length; i++) {
		const line = preloadLines[i];
		if (line.includes('require("electron")') || line.includes("require('electron')") || line.includes("electron_1")) {
			preloadInsertIndex = i + 1;
			break;
		}
	}

	if (preloadInsertIndex === -1) {
		console.error(chalk.redBright`[-] Could not find insertion point (electron import) in ${path.basename(preloadPath)}`);
		rm(extractPath);
		process.exit(1);
	}

	preloadLines.splice(preloadInsertIndex, 0, preloadPatchCode);
	preloadContent = preloadLines.join("\n");

	// Write patched preload file
	fs.writeFileSync(preloadPath, preloadContent, "utf-8");
	console.log(chalk.greenBright`[+] ${path.basename(preloadPath)} patched successfully`);

	console.log(chalk.yellowBright`[+] Repackaging app.asar...`);
	await asar.createPackage(extractPath, asarPath);
	console.log(chalk.greenBright`[+] app.asar repackaged successfully`);

	let executablePath;
	try {
		executablePath = getExecutablePath(appPath);
	} catch (e) {
		rm(extractPath);
		console.error(chalk.redBright`[-] ${e.message}`);
		process.exit(1);
	}

	console.log(chalk.yellowBright`[+] Launching HTTP Toolkit to read integrity hashes...`);
	let hashes;
	try {
		hashes = await captureIntegrityHashes(executablePath);
	} catch (e) {
		rm(extractPath);
		console.error(chalk.redBright`[-] Failed to capture integrity hashes: ${e.message}`);
		process.exit(1);
	}

	console.log(chalk.greenBright`[+] Integrity hashes captured`);
	console.log(chalk.white`    Original hash: ${hashes.originalHash}`);
	console.log(chalk.white`    New asar hash: ${hashes.newHash}`);

	try {
		const replacements = patchExecutableHash(executablePath, hashes.originalHash, hashes.newHash);
		console.log(chalk.greenBright`[+] Patched binary hash (${replacements} replacement${replacements === 1 ? "" : "s"})`);
	} catch (e) {
		rm(extractPath);
		console.error(chalk.redBright`[-] Failed to patch binary hash: ${e.message}`);
		process.exit(1);
	}

	console.log(chalk.yellowBright`[+] Cleaning up temporary files...`);
	rm(extractPath);
	console.log(chalk.greenBright`[+] Successfully patched!`);

	console.log(chalk.blueBright`[+] Opening HTTP Toolkit...`);
	try {
		const child = spawn(executablePath, {
			stdio: "ignore",
			shell: false,
			detached: true,
		});
		child.unref();
		console.log(chalk.greenBright`[+] HTTP Toolkit launched successfully`);
	} catch (e) {
		console.error(chalk.yellowBright`[!] Could not auto-start HTTP Toolkit: ${e.message}`);
		console.log(chalk.blueBright`[+] Please start HTTP Toolkit manually`);
	}
}

const args = process.argv.slice(2);
const command = args[0];

const commandName = (() => {
	// @ts-ignore - pkg adds this property at runtime
	if (process.pkg) {
		return path.basename(__filename);
	} else {
		return `node ${process.argv[1]}`;
	}
})();

// Run the appropriate command
(async () => {
	try {
		// Check for updates from GitHub
		await checkForUpdates();
		
		if (command === "unpatch" || command === "restore") {
			await unpatchApp();
		} else if (command === "help" || command === "-h" || command === "--help") {
			console.log(chalk.blueBright`HTTP Toolkit Patcher`);
			console.log(chalk.white`\nUsage:`);
			console.log(chalk.white`  ${commandName} [command]`);
			console.log(chalk.white`\nCommands:`);
			console.log(chalk.white`  patch    ${chalk.gray`- Patch HTTP Toolkit (default)`}`);
			console.log(chalk.white`  unpatch  ${chalk.gray`- Restore original HTTP Toolkit from backup`}`);
			console.log(chalk.white`  restore  ${chalk.gray`- Alias for unpatch`}`);
			console.log(chalk.white`  help     ${chalk.gray`- Show this help message`}`);
			process.exit(0);
		} else if (!command || command === "patch") {
			// Ask for confirmation before patching
			const answer = await prompt("Do you want to patch HTTP Toolkit? [Y/n]: ");
			if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
				console.log(chalk.blueBright`[+] Patching cancelled`);
				process.exit(0);
			}
			await patchApp();
		} else {
			console.error(chalk.redBright`[-] Unknown command: ${command}`);
			console.log(chalk.yellowBright`[!] Use 'help' to see available commands`);
			process.exit(1);
		}
	} catch (error) {
		console.error(chalk.redBright`[-] Error: ${error.message}`);
		process.exit(1);
	}
})();
