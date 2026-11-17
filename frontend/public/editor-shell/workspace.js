const edgePipeHandle = document.getElementById('edge-pipe-handle');
const workspaceBackdrop = document.getElementById('workspace-backdrop');
const nextWorkspace = workspaceBackdrop.querySelector('a[aria-current="false"]');
const redirectConfirmModal = document.getElementById('redirect-confirm-modal');
const btnCancelRedirect = document.getElementById('btn-cancel-redirect');
const btnConfirmRedirect = document.getElementById('btn-confirm-redirect');

const openWorkspaceBackdrop = () => {
    workspaceBackdrop.inert = false;
    workspaceBackdrop.classList.add('is-open');
    edgePipeHandle.setAttribute('aria-expanded', 'true');
};
const closeWorkspaceBackdrop = () => {
    if (workspaceBackdrop.contains(document.activeElement)) edgePipeHandle.focus({ preventScroll: true });
    workspaceBackdrop.inert = true;
    workspaceBackdrop.classList.remove('is-open');
    edgePipeHandle.setAttribute('aria-expanded', 'false');
};

edgePipeHandle.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') openWorkspaceBackdrop();
});
edgePipeHandle.addEventListener('click', (event) => {
    openWorkspaceBackdrop();
    if (event.detail === 0) nextWorkspace.focus();
});

let edgeSwipe = null;
edgePipeHandle.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    edgeSwipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    edgePipeHandle.setPointerCapture(event.pointerId);
});
edgePipeHandle.addEventListener('pointerup', (event) => {
    if (edgeSwipe?.id !== event.pointerId) return;
    const horizontal = event.clientX - edgeSwipe.x;
    const vertical = Math.abs(event.clientY - edgeSwipe.y);
    edgeSwipe = null;
    if (horizontal >= 36 && horizontal > vertical) openWorkspaceBackdrop();
});
edgePipeHandle.addEventListener('lostpointercapture', (event) => {
    if (edgeSwipe?.id === event.pointerId) edgeSwipe = null;
});

workspaceBackdrop.addEventListener('click', (event) => {
    if (event.target === workspaceBackdrop) closeWorkspaceBackdrop();
});
workspaceBackdrop.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') closeWorkspaceBackdrop();
});

workspaceBackdrop.querySelector('a[aria-current="page"]').addEventListener('click', (event) => {
    event.preventDefault();
    closeWorkspaceBackdrop();
});

nextWorkspace.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    closeWorkspaceBackdrop();
    redirectConfirmModal.classList.remove('hidden');
    btnCancelRedirect.focus();
});

function cancelRedirect() {
    redirectConfirmModal.classList.add('hidden');
    edgePipeHandle.focus({ preventScroll: true });
}

btnCancelRedirect.addEventListener('click', cancelRedirect);
redirectConfirmModal.addEventListener('click', (event) => {
    if (event.target === redirectConfirmModal) cancelRedirect();
});
btnConfirmRedirect.addEventListener('click', () => {
    window.location.assign(nextWorkspace.href);
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!workspaceBackdrop.inert) {
        closeWorkspaceBackdrop();
    } else if (!redirectConfirmModal.classList.contains('hidden')) {
        cancelRedirect();
    } else {
        return;
    }
    event.stopPropagation();
});
