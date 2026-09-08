/**
 * Option lists shared by the Add and Edit project dialogs.
 *
 * Both dialogs hardcoded their own copies. They happened to agree, but nothing
 * held them together — editing one was silent divergence between the form that
 * creates a project and the form that edits it.
 */

export const PLATFORM_OPTIONS = ["Custom", "Shopify", "Magento", "WooCommerce"] as const;

export const INTEGRATION_TYPE_OPTIONS = ["Standard", "Advanced", "Enterprise"] as const;
