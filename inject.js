(function () {
	console.log("[PAGE-INJECT] Installing hooks in page context");

	// Properties to hook directly on accountStore (still exist as computed properties)
	const propertyHooks = {
		isLoggedIn: true,
		userEmail: "hi@httptoolkit.com",
		mightBePaidUser: true,
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

	// Methods to hook on the user object (moved from accountStore properties to user methods in v3.1.0)
	const userMethodHooks = {
		isPaidUser: true,
		isPastDueUser: false,
		userHasSubscription: true,
	};

	const hookedObjects = new WeakSet();
	const hookedUsers = new WeakSet();

	// Patch user object methods
	function patchUserObject(user) {
		if (!user || typeof user !== "object" || hookedUsers.has(user)) return;

		for (const methodName of Object.keys(userMethodHooks)) {
			if (typeof user[methodName] === "function") {
				console.log("[PAGE-INJECT] Patching user." + methodName + "()");
				user[methodName] = function () {
					return userMethodHooks[methodName];
				};
			}
		}

		hookedUsers.add(user);
	}

	// Override Object.defineProperty to intercept all property definitions
	const originalDefineProperty = Object.defineProperty;
	Object.defineProperty = function (target, prop, descriptor) {
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

		// Intercept the 'user' property to patch its methods when it's set/accessed
		if (prop === "user") {
			console.log("[PAGE-INJECT] Intercepting defineProperty for: user");

			if (descriptor && descriptor.get) {
				const originalGetter = descriptor.get;
				descriptor.get = function () {
					const user = originalGetter.call(this);
					if (user) patchUserObject(user);
					return user;
				};
			} else if (descriptor && descriptor.value !== undefined && descriptor.value) {
				patchUserObject(descriptor.value);
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

			if (prop === "user") {
				console.log("[PAGE-INJECT] Intercepting defineProperties for: user");
				if (props[prop].get) {
					const originalGetter = props[prop].get;
					props[prop].get = function () {
						const user = originalGetter.call(this);
						if (user) patchUserObject(user);
						return user;
					};
				} else if (props[prop].value !== undefined && props[prop].value) {
					patchUserObject(props[prop].value);
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
				// Patch direct property hooks
				Object.keys(propertyHooks).forEach(prop => {
					try {
						const desc = Object.getOwnPropertyDescriptor(obj, prop);
						if (desc && desc.configurable) {
							console.log("[PAGE-INJECT] Found " + prop + " on object #" + idx + ", patching...");

							if (desc.get) {
								const originalGetter = desc.get;
								originalDefineProperty(obj, prop, {
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

				// Patch user object if present
				try {
					if (obj.user && typeof obj.user === "object") {
						console.log("[PAGE-INJECT] Found user object on object #" + idx + ", patching methods...");
						patchUserObject(obj.user);
					}
				} catch (e) {}

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
										originalDefineProperty(store, prop, {
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

							// Patch user methods on the store
							try {
								if (store.user && typeof store.user === "object") {
									console.log("[PAGE-INJECT] Found user object in accountStore, patching methods...");
									patchUserObject(store.user);
								}
							} catch (e) {}

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
			console.log("[PAGE-INJECT] Stopped periodic scanning after 50 attempts");
		}
	}, 100);

	console.log("[PAGE-INJECT] Hooks installed successfully");
})();
