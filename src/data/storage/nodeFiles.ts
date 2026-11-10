/**
 * Node's `fs/promises`, loaded when a storage function runs rather than when the module is imported, so the browser
 * bundle (which leaves `fs` out) can still import the storage module.
 */
export const nodeFiles = () => require('fs/promises')
