/** Resolve the extensionless ESM specifiers emitted from the bundler-oriented TypeScript source graph. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && (specifier.startsWith('./') || specifier.startsWith('../')) && !/\.(?:js|mjs|cjs|json)$/i.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}
