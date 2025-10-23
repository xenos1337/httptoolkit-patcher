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
	if (process.pkg) {
		return process.execPath;
	}
	// Check if import.meta.url exists (ESM)
	if (typeof import.meta !== 'undefined' && import.meta.url) {
		return fileURLToPath(import.meta.url);
	}
	// Fallback to __filename if in CommonJS
	return typeof __filename !== 'undefined' ? __filename : process.argv[1];
})();

// Check if running with elevated privileges
const isElevated = () => {
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
};

// Helper function to prompt user for input
const prompt = question => {
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
};

// Helper function to fetch content from URL
const fetchUrl = url => {
	return new Promise((resolve, reject) => {
		https
			.get(url, res => {
				let data = "";
				res.on("data", chunk => (data += chunk));
				res.on("end", () => resolve(data));
			})
			.on("error", reject);
	});
};

// Helper function to remove directory recursively
const rm = dirPath => {
	if (!fs.existsSync(dirPath)) return;
	if (!fs.lstatSync(dirPath).isDirectory()) return fs.rmSync(dirPath, { force: true });
	for (const entry of fs.readdirSync(dirPath)) {
		const entryPath = path.join(dirPath, entry);
		if (fs.lstatSync(entryPath).isDirectory()) rm(entryPath);
		else fs.rmSync(entryPath, { force: true });
	}
	fs.rmdirSync(dirPath);
};

// Find HTTP Toolkit installation path
const findAppPath = async () => {
	const possiblePaths = isWin ? [path.join("C:", "Program Files", "HTTP Toolkit", "resources"), path.join("C:", "Program Files (x86)", "HTTP Toolkit", "resources")] : isMac ? ["/Applications/HTTP Toolkit.app/Contents/Resources"] : ["/opt/HTTP Toolkit/resources", "/opt/httptoolkit/resources"];

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
};

// Request elevated permissions
const requestElevation = async () => {
	console.log(chalk.yellowBright`[!] Requesting elevated permissions...`);

	if (isWin) {
		// Windows: Use PowerShell to run as administrator
		const script = `Start-Process -FilePath "node" -ArgumentList '"${__filename}"' -Verb RunAs`;
		try {
			spawn("powershell", ["-Command", script], {
				stdio: "inherit",
				shell: true,
			});
			console.log(chalk.blueBright`[+] Restarting with administrator privileges...`);
			process.exit(0);
		} catch (e) {
			console.error(chalk.redBright`[-] Failed to elevate permissions: ${e.message}`);
			console.error(chalk.redBright`[-] Please run as administrator manually`);
			process.exit(1);
		}
	} else {
		console.log(chalk.blueBright`[+] Restarting with sudo...`);
		try {
			const child = spawn("sudo", ["node", __filename], {
				stdio: "inherit",
			});
			child.on("exit", code => process.exit(code || 0));
		} catch (e) {
			console.error(chalk.redBright`[-] Failed to elevate permissions: ${e.message}`);
			console.error(chalk.redBright`[-] Please run with sudo manually`);
			process.exit(1);
		}
	}
};

// Check if we have write permissions
const checkPermissions = filePath => {
	try {
		fs.accessSync(filePath, fs.constants.W_OK);
		return true;
	} catch (e) {
		return false;
	}
};

// Kill HTTP Toolkit processes
const killHttpToolkit = async () => {
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
};

// Unpatch/restore function
const unpatchApp = async () => {
	console.log(chalk.blueBright`[+] HTTP Toolkit Unpatcher Started`);

	// Step 1: Find app path
	const appPath = await findAppPath();
	console.log(chalk.greenBright`[+] HTTP Toolkit found at ${appPath}`);

	// Step 2: Kill HTTP Toolkit if running
	await killHttpToolkit();

	// Step 3: Check permissions
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
		const answer = await prompt("Do you want to request elevated permissions? [Y/n]: ");
		if (!answer || answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
			await requestElevation();
		} else {
			console.log(chalk.redBright`[-] Cannot proceed without write permissions`);
			process.exit(1);
		}
	}

	// Step 4: Check if backup exists
	if (!fs.existsSync(backupPath)) {
		console.error(chalk.redBright`[-] Backup file not found at ${backupPath}`);
		console.error(chalk.redBright`[-] Cannot unpatch without backup file`);
		process.exit(1);
	}

	// Step 5: Restore from backup
	console.log(chalk.yellowBright`[+] Restoring from backup...`);
	try {
		fs.copyFileSync(backupPath, asarPath);
		console.log(chalk.greenBright`[+] Restored app.asar from backup`);
	} catch (e) {
		console.error(chalk.redBright`[-] Failed to restore backup: ${e.message}`);
		process.exit(1);
	}

	// Step 6: Clean up extracted files if they exist
	if (fs.existsSync(extractPath)) {
		console.log(chalk.yellowBright`[+] Removing extracted files...`);
		rm(extractPath);
		console.log(chalk.greenBright`[+] Cleaned up extracted files`);
	}

	// Step 7: Optionally remove backup
	const removeBackup = await prompt("Do you want to remove the backup file? (y/n): ");
	if (removeBackup.toLowerCase() === "y" || removeBackup.toLowerCase() === "yes") {
		fs.rmSync(backupPath, { force: true });
		console.log(chalk.greenBright`[+] Backup file removed`);
	}

	console.log(chalk.greenBright`[+] Successfully unpatched!`);
};

// Main patching function
const patchApp = async () => {
	console.log(chalk.blueBright`[+] HTTP Toolkit Patcher Started`);

	// Step 1: Find app path
	const appPath = await findAppPath();
	console.log(chalk.greenBright`[+] HTTP Toolkit found at ${appPath}`);

	// Step 2: Kill HTTP Toolkit if running
	await killHttpToolkit();

	// Step 3: Check permissions
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
		const answer = await prompt("Do you want to request elevated permissions? [Y/n]: ");
		if (!answer || answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
			await requestElevation();
		} else {
			console.log(chalk.redBright`[-] Cannot proceed without write permissions`);
			process.exit(1);
		}
	}

	// Step 4: Backup app.asar
	const backupPath = path.join(appPath, "app.asar.bak");
	if (!fs.existsSync(backupPath)) {
		console.log(chalk.yellowBright`[+] Creating backup...`);
		fs.copyFileSync(asarPath, backupPath);
		console.log(chalk.greenBright`[+] Backup created at ${backupPath}`);
	}

	// Step 5: Extract app.asar
	const extractPath = path.join(appPath, "app.asar_extracted");
	console.log(chalk.yellowBright`[+] Extracting app.asar...`);
	rm(extractPath);
	asar.extractAll(asarPath, extractPath);
	console.log(chalk.greenBright`[+] Extracted to ${extractPath}`);

	// Step 6: Check if preload.js exists
	const preloadPath = path.join(extractPath, "build", "preload.js");
	if (!fs.existsSync(preloadPath)) {
		console.error(chalk.redBright`[-] preload.js not found at ${preloadPath}`);
		rm(extractPath);
		process.exit(1);
	}

	// Step 7: Fetch inject.js from GitHub
	console.log(chalk.yellowBright`[+] Fetching inject code from GitHub...`);
	const injectCode = await fetchUrl("https://raw.githubusercontent.com/xenos1337/httptoolkit-patcher/refs/heads/master/inject.js");
	if (!injectCode || !injectCode.includes("injectPageContextHooks")) {
		console.error(chalk.redBright`[-] Failed to fetch inject.js from GitHub`);
		rm(extractPath);
		process.exit(1);
	}
	console.log(chalk.greenBright`[+] Inject code fetched successfully`);

	// Step 8: Read preload.js and check if already patched
	let preloadContent = fs.readFileSync(preloadPath, "utf-8");
	const isPatched = preloadContent.includes("injectPageContextHooks");

	if (isPatched) {
		console.log(chalk.yellowBright`[!] File already patched`);
		const answer = await prompt("Do you want to repatch? (y/n): ");

		if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
			console.log(chalk.blueBright`[+] Patching cancelled`);
			rm(extractPath);
			process.exit(0);
		}

		// Replace the existing injectPageContextHooks function
		console.log(chalk.yellowBright`[+] Replacing existing patch...`);
		const functionRegex = /\(function injectPageContextHooks\(\) \{[\s\S]*?\}\)\(\);/;
		preloadContent = preloadContent.replace(functionRegex, injectCode);
	} else {
		// Find line with electron_1 and insert inject code below it
		console.log(chalk.yellowBright`[+] Applying patch...`);
		const lines = preloadContent.split("\n");
		let insertIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes("electron_1")) {
				insertIndex = i + 1;
				break;
			}
		}

		if (insertIndex === -1) {
			console.error(chalk.redBright`[-] Could not find insertion point (electron_1) in preload.js`);
			rm(extractPath);
			process.exit(1);
		}

		lines.splice(insertIndex, 0, injectCode);
		preloadContent = lines.join("\n");
	}

	// Step 9: Write patched preload.js
	fs.writeFileSync(preloadPath, preloadContent, "utf-8");
	console.log(chalk.greenBright`[+] preload.js patched successfully`);

	// Step 10: Repackage app.asar
	console.log(chalk.yellowBright`[+] Repackaging app.asar...`);
	await asar.createPackage(extractPath, asarPath);
	console.log(chalk.greenBright`[+] app.asar repackaged successfully`);

	// Step 11: Clean up
	console.log(chalk.yellowBright`[+] Cleaning up temporary files...`);
	rm(extractPath);
	console.log(chalk.greenBright`[+] Successfully patched!`);

	// Step 12: Open HTTP Toolkit as detached process
	console.log(chalk.blueBright`[+] Opening HTTP Toolkit...`);
	try {
		const command = isWin ? `"${path.resolve(appPath, "..", "HTTP Toolkit.exe")}"` : isMac ? 'open -a "HTTP Toolkit"' : "httptoolkit";
		const child = spawn(command, {
			stdio: "ignore",
			shell: true,
			detached: true,
		});
		child.unref(); // Completely detach the child process
		console.log(chalk.greenBright`[+] HTTP Toolkit launched successfully`);
	} catch (e) {
		console.error(chalk.yellowBright`[!] Could not auto-start HTTP Toolkit: ${e.message}`);
		console.log(chalk.blueBright`[+] Please start HTTP Toolkit manually`);
	}
};

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Get the command name for display
const commandName = process.pkg ? path.basename(__filename) : 'node index.js';

// Run the appropriate command
(async () => {
	try {
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
