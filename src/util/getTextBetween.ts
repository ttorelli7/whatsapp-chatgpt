export function getTextBetween(text: string, begin: string, end: string): string {
    const startIndex = text.indexOf(begin);
    const endIndex = text.indexOf(end, startIndex + begin.length);

    if (startIndex !== -1 && endIndex !== -1) {
        return text.substring(startIndex + begin.length, endIndex);
    }
    return '';
}