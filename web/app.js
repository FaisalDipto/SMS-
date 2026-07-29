(() => {
  const statusMessage = document.querySelector('#status-message');
  const appView = document.querySelector('#app-view');

  if (!statusMessage || !appView || !window.SMSWeb?.renderer) {
    return;
  }

  statusMessage.textContent = 'The local application shell is loaded and ready.';
  window.SMSWeb.renderer.mount(appView, window.SMSWeb.renderer.renderHomePage({
    title: 'Welcome to SMSWeb',
    message: 'Choose a local information page to get started.'
  }));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app remains usable without caching when service workers are unavailable.
    });
  }
})();
