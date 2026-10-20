import { formatSums, parseSumsInput } from './money';

describe('money', () => {
  test('parseSumsInput("1.15") === 115; formatSums(15000000) === "150 000,00"', () => {
    expect(parseSumsInput('1.15')).toBe(115);
    expect(formatSums(15000000)).toBe('150 000,00');
  });

  test('parseSumsInput accepts comma, integers and one decimal', () => {
    expect(parseSumsInput('1000')).toBe(100000);
    expect(parseSumsInput('1000.50')).toBe(100050);
    expect(parseSumsInput('1000,5')).toBe(100050);
    expect(parseSumsInput(' 2 ')).toBe(200);
  });

  test('parseSumsInput rejects invalid input', () => {
    for (const text of ['', 'abc', '0', '0,00', '-5', '1.234', '1..2', '1e3', ',5', '1,']) {
      expect(parseSumsInput(text)).toBeNull();
    }
  });

  test('formatSums handles small, negative and exact values', () => {
    expect(formatSums(0)).toBe('0,00');
    expect(formatSums(5)).toBe('0,05');
    expect(formatSums(100)).toBe('1,00');
    expect(formatSums(123456789)).toBe('1 234 567,89');
    expect(formatSums(-250050)).toBe('-2 500,50');
  });
});
