# HTTP Toolkit Patcher

A minimal, cross-platform patcher for HTTP Toolkit that removes subscription requirements.

![WindowsTerminal_BsiVsdyUoj](https://github.com/user-attachments/assets/f21dda33-9334-4b6d-b8ae-6cd51937b3cd)

## Why?

I don't feel like paying a **monthly subscription** for an HTTP proxy/interceptor. A lifetime license? Sure. But subscription-based for a dev tool? No thanks.

## How It Works

The patcher intercepts HTTP Toolkit's authentication functions:
- `isPaidUser`
- `isLoggedIn`
- `userHasSubscription`
- `userEmail`
- `mightBePaidUser`
- `isPastDueUser`

By hooking these functions, we bypass the subscription checks entirely.

### Can They Fix It?

Yes, but they most likely won't. Fixing this would require changing their entire codebase architecture. And if they do? I'll just update the patcher.

## Installation

1. Install dependencies:
```bash
npm install
```

## Building

Build standalone executables for all platforms and architectures:

```bash
npm run build
```

This creates self-contained executables in the `dist/` directory:

**Windows:**
- `httptoolkit-patcher-win-x64.exe` (64-bit)

**Linux:**
- `httptoolkit-patcher-linux-x64` (x86_64/AMD64)
- `httptoolkit-patcher-linux-arm64` (ARM64/AArch64)

**macOS:**
- `httptoolkit-patcher-macos-x64` (Intel)
- `httptoolkit-patcher-macos-arm64` (Apple Silicon M Chip)

**Note:** These are standalone executables created with `pkg` that include Node.js runtime and all dependencies. No need to install Node.js separately!

## Usage

### From Source

**Patch:**
```bash
npm start
```

**Unpatch:**
```bash
npm run unpatch
```

### Using Prebuilt Executables

Download the appropriate executable for your platform from [Releases](https://github.com/xenos1337/httptoolkit-patcher/releases), then:

**Windows:**
```cmd
httptoolkit-patcher-win-x64.exe
```

**Linux/macOS:**
```bash
chmod +x httptoolkit-patcher-linux-x64  # or your architecture
./httptoolkit-patcher-linux-x64
```

That's it. The patcher handles everything automatically.

## Technical Details

1. Finds HTTP Toolkit installation
2. Kills running processes
3. Requests elevation if needed
4. Backs up `app.asar`
5. Extracts and patches `preload.js`
6. Repackages and launches

## Troubleshooting

**Permission errors?** Run as admin/sudo or let the patcher request elevation.

**Already patched?** The patcher will ask if you want to repatch.

**Want to restore?** Run `npm run unpatch` to restore from backup.

**Anything else?** Open an issue on the [GitHub repository](https://github.com/xenos1337/httptoolkit-patcher/issues).

## GitHub Release Workflow

This project includes an automated GitHub Actions workflow that builds and releases the patcher for all platforms.

### Creating a Release

1. Create and push a version tag:
```bash
git tag v2.0.1
git push origin v2.0.1
```

2. The GitHub Actions workflow will automatically:
   - Build for all platforms and architectures (Windows x64, Linux x64/ARM64, macOS Intel/Apple Silicon)
   - Create standalone native executables using pkg
   - Create a GitHub release with all binaries as downloadable artifacts

### Manual Workflow Trigger

You can also manually trigger the release workflow from the GitHub Actions tab.

## Disclaimer

This tool is provided as-is. Use at your own risk. For educational purposes only.

## License

MIT License - see [LICENSE](LICENSE) file.

