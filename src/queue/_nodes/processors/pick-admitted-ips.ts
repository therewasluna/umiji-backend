/**
 * What holds a slot, matching the node's core: an IPv4 address, or an IPv6 /64. A phone's
 * temporary IPv6 addresses rotate inside its /64. The node re-parses it, so only consistency matters.
 */
export function slotKey(ip: string): string {
    const addr = ip.replace(/^\[|\]$/g, '');
    if (!addr.includes(':')) return addr;
    const [head, tail] = addr.split('::');
    const groups = head ? head.split(':') : [];
    if (tail !== undefined) {
        const end = tail ? tail.split(':') : [];
        groups.push(...Array(8 - groups.length - end.length).fill('0'), ...end);
    }
    return `${groups
        .slice(0, 4)
        .map((g) => parseInt(g, 16).toString(16))
        .join(':')}::/64`;
}

/**
 * Which IPs keep a limited user's slots across all nodes: the ones that held them last sweep
 * and are still online, then the least recently active of the rest, up to the limit.
 * Keeping last sweep's IPs first stops two devices from taking turns being cut.
 *
 * @param seen online IP -> last seen (ms), merged from every node
 */
export function pickAdmittedIps(
    limit: number,
    seen: Map<string, number>,
    previous: string[] = [],
): string[] {
    const kept = previous.filter((ip) => seen.has(ip)).slice(0, limit);
    const rest = [...seen.entries()]
        .filter(([ip]) => !kept.includes(ip))
        .sort((a, b) => a[1] - b[1])
        .map(([ip]) => ip);

    return [...kept, ...rest].slice(0, limit);
}
