// gpt-4o reliably follows the $...$ / $$...$$ math instruction in
// isolation, but in this app's full system prompt it consistently reverts
// to a "safe" plain-text math style instead: \[ V \propto I \] for block
// equations, and — for inline variables — parens *with padding spaces*
// like "( V )", while genuine unit abbreviations like "(V)" for volts stay
// tight with no padding. That padding is a reliable, consistently
// self-distinguishing signal (verified against multiple real generations),
// so this converts the model's actual observed output into real math
// delimiters rather than continuing to fight it through prompting alone.
export function normalizeMathDelimiters(text: string): string {
  let out = text;

  // \[ ... \] -> $$...$$
  out = out.replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_, expr) => `$$${expr}$$`);
  // \( ... \) -> $...$
  out = out.replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_, expr) => `$${expr}$`);

  // Bare [ ... ] with padding spaces on both sides (block-ish equations
  // the model sometimes emits without any backslash at all).
  out = out.replace(/\[\s+([^[\]]+?)\s+\]/g, (_, expr) => `$$${expr}$$`);

  // Bare ( ... ) — only when padded with spaces on both sides, which is
  // how this model marks "this is math" vs. a tight "(V)" unit/aside.
  out = out.replace(/\(\s+([^()]+?)\s+\)/g, (_, expr) => `$${expr}$`);

  return out;
}
