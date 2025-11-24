# HTTP Toolkit Patcher

A minimal, cross-platform patcher for HTTP Toolkit that removes subscription requirements.

![WindowsTerminal_BsiVsdyUoj](https://github.com/user-attachments/assets/20a226f3-4620-4a0e-b1df-8cc55609203c)

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

1. Install Node.js (if not already installed)
2. Install dependencies:
```bash
npm install
```

## Usage

**Patch HTTP Toolkit:**
```bash
npm start
```

**Unpatch/Restore:**
```bash
npm run unpatch
```

**Show help:**
```bash
npm start help
```

That's it. The patcher handles everything automatically and will request elevated permissions if needed.

## Technical Details

1. Finds HTTP Toolkit installation
2. Kills running processes
3. Requests elevation if needed
4. Backs up `app.asar`
5. Extracts and patches `preload.js`
6. Repackages and launches

## Troubleshooting

**Permission errors?** The patcher will automatically request elevated permissions (admin/sudo).

**Already patched?** The patcher will ask if you want to repatch.

**Want to restore?** Run `npm run unpatch` to restore from backup.

**Anything else?** Open an issue on the [GitHub repository](https://github.com/xenos1337/httptoolkit-patcher/issues).

## Disclaimer

This tool is provided as-is. Use at your own risk. For educational purposes only.

## License

MIT License - see [LICENSE](LICENSE) file.

