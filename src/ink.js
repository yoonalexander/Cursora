export const INK_COLORS = Object.freeze([
    { name: "Black", value: "#000000" },
    { name: "Red", value: "#db8989" },
    { name: "Blue", value: "#88aadd" },
    { name: "Yellow", value: "#e6d083" },
    { name: "Green", value: "#8cba99" },
    { name: "Rainbow", value: "rainbow" }
]);

export function inkIndexFromKey(event, currentIndex) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return null;
    if (event.target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return null;
    if (/^[1-6]$/.test(event.key)) return Number(event.key) - 1;
    if (event.key.toLowerCase() === "c") return (currentIndex + 1) % INK_COLORS.length;
    return null;
}
