export const NODE_INSTALL_CONTROLLER = 'node-install' as const;

export const NODE_INSTALL_ROUTES = {
    START: '', // post
    GET: (id: string) => `${id}`, // get
} as const;
