(() => {
  const statusMessage = document.querySelector('#status-message');

  if (!statusMessage) {
    return;
  }

  statusMessage.textContent = 'The local application shell is loaded and ready.';
})();
