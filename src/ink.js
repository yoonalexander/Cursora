export const INK_COLORS = Object.freeze([
    { name: "Black", value: "#000000" },
    { name: "Red", value: "#D96868" },
    { name: "Blue", value: "#3368A0" },
    { name: "Yellow", value: "#FFEA88" },
    { name: "Green", value: "#689D4B" },
    { name: "Rainbow", value: "rainbow" }
]);

export function inkIndexFromKey(event, currentIndex) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return null;
    if (event.target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return null;
    if (/^[1-6]$/.test(event.key)) return Number(event.key) - 1;
    if (event.key.toLowerCase() === "c") return (currentIndex + 1) % INK_COLORS.length;
    return null;
}
