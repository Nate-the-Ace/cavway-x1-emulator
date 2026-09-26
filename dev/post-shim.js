// Dev harness only: install the shim in this frame, then hide the hook.
(function () {
  const h = globalThis.__CVX1_TEST__;
  delete globalThis.__CVX1_TEST__;
  h.install(window, navigator, Navigator, h.domChooser);
})();
