(function () {
	console.log("[PAGE-INJECT] Installing hooks in page context");

	const propertyHooks = {
		isPaidUser: true,
		isLoggedIn: true,
		userHasSubscription: true,
		userEmail: "hi@httptoolkit.com",
		mightBePaidUser: true,
		isPastDueUser: false,
		isStatusUnexpired: true,
		userSubscription: {
			state: "fulfilled",
			status: "active",
			plan: "pro",
			sku: "sku",
			tierCode: "pro",
			interval: "monthly",
			quantity: 1,
			expiry: new Date(new Date().setFullYear(new Date().getFullYear() + 10)),
			updateBillingDetailsUrl: "https://httptoolkit.com/",
			cancelSubscriptionUrl: "https://httptoolkit.com/",
			lastReceiptUrl: "https://httptoolkit.com/",
			canManageSubscription: true,
		},
	};

	const hookedObjects = new WeakSet();

	// Override Object.defineProperty to intercept all property definitions
	const originalDefineProperty = Object.defineProperty;
	Object.defineProperty = function (target, prop, descriptor) {
		// Intercept our target properties
		if (prop in propertyHooks) {
			console.log("[PAGE-INJECT] Intercepting defineProperty for: " + prop);

			if (descriptor && descriptor.get) {
				const originalGetter = descriptor.get;
				descriptor.get = function () {
					const originalValue = originalGetter.call(this);
					console.log("[PAGE-INJECT] " + prop + " getter called, original=" + originalValue + ", returning=" + JSON.stringify(propertyHooks[prop]));
					return propertyHooks[prop];
				};
			} else if (descriptor && descriptor.value !== undefined) {
				console.log("[PAGE-INJECT] " + prop + " value being defined, overriding to " + JSON.stringify(propertyHooks[prop]));
				descriptor.value = propertyHooks[prop];
			}
		}

		return originalDefineProperty.call(this, target, prop, descriptor);
	};

	// Hook Object.defineProperties too
	const originalDefineProperties = Object.defineProperties;
	Object.defineProperties = function (target, props) {
		for (let prop in props) {
			if (prop in propertyHooks) {
				console.log("[PAGE-INJECT] Intercepting defineProperties for: " + prop);
				if (props[prop].get) {
					const originalGetter = props[prop].get;
					props[prop].get = function () {
						const originalValue = originalGetter.call(this);
						console.log("[PAGE-INJECT] " + prop + " getter called, original=" + originalValue + ", returning=" + JSON.stringify(propertyHooks[prop]));
						return propertyHooks[prop];
					};
				} else if (props[prop].value !== undefined) {
					props[prop].value = propertyHooks[prop];
				}
			}
		}
		return originalDefineProperties.call(this, target, props);
	};

	// Periodically scan and patch existing objects
	function scanAndPatch() {
		// Search through window and common store locations
		const searchPaths = [window, window.accountStore, window.stores && window.stores.accountStore, window.appState && window.appState.accountStore];

		searchPaths.forEach((obj, idx) => {
			if (!obj || hookedObjects.has(obj)) return;

			try {
				Object.keys(propertyHooks).forEach(prop => {
					try {
						const desc = Object.getOwnPropertyDescriptor(obj, prop);
						if (desc && desc.configurable) {
							console.log("[PAGE-INJECT] Found " + prop + " on object #" + idx + ", patching...");

							if (desc.get) {
								const originalGetter = desc.get;
								Object.defineProperty(obj, prop, {
									get: function () {
										const originalValue = originalGetter.call(this);
										console.log("[PAGE-INJECT] " + prop + " getter intercepted, original=" + originalValue + ", returning=" + JSON.stringify(propertyHooks[prop]));
										return propertyHooks[prop];
									},
									set: desc.set,
									configurable: true,
									enumerable: desc.enumerable,
								});
							} else if (desc.writable) {
								obj[prop] = propertyHooks[prop];
								console.log("[PAGE-INJECT] " + prop + " value set to " + JSON.stringify(propertyHooks[prop]));
							}
						}
					} catch (e) {
						// Ignore individual property errors
					}
				});

				hookedObjects.add(obj);
			} catch (e) {
				// Ignore object access errors
			}
		});

		// Also try to find accountStore by scanning window properties
		try {
			for (let key in window) {
				try {
					const obj = window[key];
					if (obj && typeof obj === "object" && "accountStore" in obj) {
						console.log("[PAGE-INJECT] Found accountStore in window." + key);
						const store = obj.accountStore;
						if (store && !hookedObjects.has(store)) {
							Object.keys(propertyHooks).forEach(prop => {
								try {
									const desc = Object.getOwnPropertyDescriptor(store, prop);
									if (desc && desc.configurable && desc.get) {
										const originalGetter = desc.get;
										Object.defineProperty(store, prop, {
											get: function () {
												const originalValue = originalGetter.call(this);
												console.log("[PAGE-INJECT] accountStore." + prop + " intercepted, original=" + originalValue + ", returning=" + JSON.stringify(propertyHooks[prop]));
												return propertyHooks[prop];
											},
											set: desc.set,
											configurable: true,
											enumerable: desc.enumerable,
										});
									}
								} catch (e) {}
							});
							hookedObjects.add(store);
						}
					}
				} catch (e) {}
			}
		} catch (e) {}
	}

	// Run initial scan
	scanAndPatch();

	// Scan periodically for late-initialized stores
	let scanCount = 0;
	const scanInterval = setInterval(() => {
		scanCount++;
		scanAndPatch();

		if (scanCount >= 50) {
			clearInterval(scanInterval);
			console.log("[PAGE-INJECT] Stopped periodic scanning after 10 attempts");
		}
	}, 100);

	console.log("[PAGE-INJECT] Hooks installed successfully");
})();
