export interface TableRow {
    label: string;
    value: string;
}

export function visibleLength(str: string): number {
    return str.replace(/\x1B\[[0-9;]*m/g, "").length;
}
export function padEnd(str: string, len: number): string {
    const diff = len - visibleLength(str);
    return diff > 0 ? str + " ".repeat(diff) : str;
}
export function buildBox(
    title: string,
    rows: TableRow[],
    width = 62,
): string[] {
    const innerWidth = width - 2;
    const titlePadded = ` ${title} `;
    const titleLen = visibleLength(titlePadded);
    const dashLeft = Math.floor((innerWidth - titleLen) / 2);
    const dashRight = innerWidth - titleLen - dashLeft;
    const header =
        "╔" + "═".repeat(dashLeft) + titlePadded + "═".repeat(dashRight) + "╗";

    const labelColWidth = Math.max(...rows.map((r) => visibleLength(r.label)));
    const valueColWidth = innerWidth - labelColWidth - 5;

    const lines = rows.map((r) => {
        const lbl = padEnd(r.label, labelColWidth);
        const val = padEnd(r.value, valueColWidth);
        return `║  ${lbl}  │  ${val}  ║`;
    });

    const footer = "╚" + "═".repeat(innerWidth) + "╝";

    return [header, ...lines, footer];
}
