export function stripIniInlineComment(input: string): string {
    const commentIndex = Math.min(
        input.indexOf(";") >= 0 ? input.indexOf(";") : Infinity,
        input.indexOf("#") >= 0 ? input.indexOf("#") : Infinity
    );

    if (commentIndex < Infinity) {
        return input.substring(0, commentIndex).trim();
    }

    return input.trim();
}

export function splitIniValueTokens(input: string): string[] {
    return input
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}

export function isLikelySectionReference(value: string): boolean {
    return !value.includes(" ") && !/^\d+$/.test(value);
}

export function uniqueValues(values: string[]): string[] {
    return Array.from(new Set(values));
}
