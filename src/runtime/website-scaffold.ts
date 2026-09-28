import { resolvePlanProviders } from '../providers/provider.resolver';
import { evaluatePlanAuthorization } from '../core/authorization';
import { prepareExecutionPlan, withProviderSelections } from '../planning/prepared-plan';
import { SingleAuthorizedProviderPolicy, selectPreparedPlanProviders } from '../providers/provider-selection.policy';
import { CanonicalExecutionKernel } from '../execution/canonical-execution-kernel';
import type { ExecutionPlan } from '../planning/plan.types';
import { createBiktingOwnedTools } from './bikting-owned-tools';
import type { ExecutionEvent } from '../execution/events';

export interface ScaffoldFiles { 'index.html': string; 'styles.css': string; 'script.js': string }

/** Deterministic site starter returned as data, without evaluating code or writing files. */
export function createWebsiteScaffold(): ScaffoldFiles {
  return {
    'index.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My Personal Website</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <header><a class="brand" href="#home">My Website</a><nav><a href="#about">About</a><a href="#projects">Projects</a><a href="#contact">Contact</a></nav></header>\n  <main id="home">\n    <section class="hero"><p class="eyebrow">WELCOME</p><h1>Hello, I'm Your Name.</h1><p>Introduce yourself and the work you care about here.</p><a class="button" href="#projects">Explore my work</a></section>\n    <section id="about"><h2>About me</h2><p>Write a short introduction about your background and goals.</p></section>\n    <section id="projects"><h2>Projects</h2><div class="cards"><article><h3>Project one</h3><p>Describe a project and the problem it solves.</p></article><article><h3>Project two</h3><p>Share another piece of work here.</p></article></div></section>\n    <section id="contact"><h2>Contact</h2><p>Add a contact method you want visitors to use.</p></section>\n  </main>\n  <footer><small>© <span id="year"></span> My Website</small></footer>\n  <script src="script.js" defer></script>\n</body>\n</html>\n`,
    'styles.css': `:root{font-family:system-ui,sans-serif;color:#17262b;background:#f5faf9;line-height:1.6}*{box-sizing:border-box}body{margin:0}header,footer{padding:1.2rem max(1.5rem,calc((100vw - 70rem)/2));display:flex;justify-content:space-between;align-items:center}header{background:#fff;gap:1rem;flex-wrap:wrap}nav{display:flex;gap:1.2rem;flex-wrap:wrap}a{color:#0e7772;text-decoration:none}.brand{font-weight:800;color:#17262b}main{max-width:70rem;margin:auto;padding:0 1.5rem}section{padding:4rem 0}.hero{padding:7rem 0}.hero h1{font-size:clamp(2.5rem,6vw,5rem);line-height:1.1;max-width:12ch}.eyebrow{color:#0e7772;font-weight:700;letter-spacing:.15em}.button{display:inline-block;background:#0e7772;color:white;border-radius:.6rem;padding:.8rem 1.2rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem}.cards article{background:white;border-radius:1rem;padding:1.5rem;box-shadow:0 6px 24px #17262b14}footer{border-top:1px solid #d5e5e2}\n`,
    'script.js': `document.getElementById('year').textContent = String(new Date().getFullYear());\n`,
  };
}

export async function runPlannedWebsiteScaffold(plan: ExecutionPlan, onEvent?: (event: ExecutionEvent) => void) {
  if (plan.status !== 'ready' || plan.steps.length !== 1 || plan.steps[0].capabilityId !== 'code.scaffold' || plan.requiredCapabilityIds?.length !== 1 || plan.requiredCapabilityIds[0] !== 'code.scaffold') throw new Error('Only a validated one-step website scaffold plan can run locally.');
  const { capabilities, providers, invoker } = createBiktingOwnedTools();
  const resolution = resolvePlanProviders(plan, capabilities, providers);
  const authorization = evaluatePlanAuthorization(resolution, []);
  let prepared = prepareExecutionPlan(plan, resolution, authorization);
  prepared = withProviderSelections(prepared, selectPreparedPlanProviders(prepared, new SingleAuthorizedProviderPolicy()));
  const result = await new CanonicalExecutionKernel(capabilities, providers, invoker).execute({ preparedPlan: prepared, projectId: 'browser-website-scaffold', onEvent });
  const output = result.outputs[plan.steps[0].id] as { files?: ScaffoldFiles } | undefined;
  if (result.status !== 'completed' || !output?.files || !validateFiles(output.files)) throw new Error('Website scaffold did not pass structural checks.');
  return { planId: result.planId, providerId: 'local.website-scaffold', files: output.files, validated: true };
}

function validateFiles(files: ScaffoldFiles): boolean {
  return Object.keys(files).sort().join(',') === 'index.html,script.js,styles.css'
    && files['index.html'].includes('href="styles.css"')
    && files['index.html'].includes('src="script.js"')
    && Object.values(files).every((value) => typeof value === 'string' && value.length > 0);
}
