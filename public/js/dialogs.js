export function installClosedByFallback() {
  if ('closedBy' in HTMLDialogElement.prototype) return;

  const isOutside = (event, dialog) => {
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };

  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (event) => {
      pressedOutside = isOutside(event, dialog);
    });
    dialog.addEventListener('pointerup', (event) => {
      if (pressedOutside && isOutside(event, dialog)) {
        dialog.close();
      }
      pressedOutside = false;
    });
  }
}

export function wireDialogReset(dialog, onClose) {
  dialog.addEventListener('close', () => {
    const returnValue = dialog.returnValue || '';
    // Clear returnValue immediately so Esc/backdrop dismissals never reuse stale values.
    dialog.returnValue = '';
    if (typeof onClose === 'function') {
      onClose(returnValue);
    }
  });
}

export function createConfirmController(dialog, { titleEl, messageEl, confirmBtn }) {
  let pendingResolve = null;

  wireDialogReset(dialog, (returnValue) => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(returnValue === 'confirm');
    }
  });

  return function askConfirm({ title, message, confirmLabel = 'Delete' }) {
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmLabel;

    return new Promise((resolve) => {
      pendingResolve = resolve;
      dialog.showModal();
    });
  };
}
