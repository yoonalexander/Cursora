export const INK_COLORS = Object.freeze([
    { name: "Black", value: "#30312f" },
    { name: "Blue", value: "#2868b2" },
    { name: "Purple", value: "#8053aa" },
    { name: "Pink", value: "#c34f87" },
    { name: "Orange", value: "#be681e" },
    { name: "Teal", value: "#287d79" }
]);

export function inkIndexFromKey(event, currentIndex) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return null;
    if (event.target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return null;
    if (/^[1-6]$/.test(event.key)) return Number(event.key) - 1;
    if (event.key.toLowerCase() === "c") return (currentIndex + 1) % INK_COLORS.length;
    return null;
}
