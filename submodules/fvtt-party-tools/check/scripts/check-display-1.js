export const signedBonus = value => Number(value) >= 0 ? `+${value}` : String(value).replace(/^-/,"−");

/** Read the same native parts as dnd5e's no-dialog skill/ability roll. Never roll dice here. */
export function checkBonusSummary(actor, check, row = {}, sourceApplied = () => false, result = null) {
  if (result) return { text: signedBonus(result.total-result.kept), baseFixed: result.total-result.kept };
  const ability = actor.system.abilities?.[check.ability ?? check.key];
  const skill = check.kind === "skill" ? actor.system.skills?.[check.key] : null;
  const prof = skill?.prof ?? ability?.checkProf;
  const configuration = {
    mod: ability?.mod ?? 0,
    prof: prof?.hasProficiency ? prof.term : null,
    skillSpecific: skill?.bonuses?.check,
    abilitySpecific: ability?.bonuses?.check,
    allChecks: actor.system.bonuses?.abilities?.check,
    allSkills: skill ? actor.system.bonuses?.abilities?.skill : null
  };
  const { parts, data } = CONFIG.Dice.D20Roll.constructParts(configuration, actor.getRollData());
  actor.addRollExhaustion?.(parts,data);
  let fixed = 0;
  const variable = [];
  const add = expression => {
    if (!expression || String(expression).trim() === "0") return;
    const formula = Roll.replaceFormulaData(String(expression),data);
    try {
      const term = new Roll(formula);
      if (term.isDeterministic) {
        const number = term.evaluateSync().total;
        if (Number.isFinite(number)) { fixed += number; return; }
      }
      variable.push(term.formula);
    } catch { variable.push(formula); }
  };
  parts.forEach(add);
  const baseFixed = fixed;
  for (const index of row.selectedSources ?? []) {
    const source = check.sources?.[index];
    if (source?.bonusText && !sourceApplied(actor,row,source)) add(source.bonusText);
  }
  let text = signedBonus(fixed);
  for (const expression of variable) {
    const clean = expression.trim().replace(/^\+\s*/,"");
    text += /^[-−]/.test(clean) ? ` − ${clean.replace(/^[-−]\s*/,"")}` : ` + ${clean}`;
  }
  return { text, baseFixed };
}
