export async function disableValidation(collections: string[]) {
  await setValidationLevel(collections, 'off');
}

export async function enableValidation(collections: string[]) {
  await setValidationLevel(collections, 'moderate');
}

async function setValidationLevel(
  collections: string[],
  validationLevel: string,
) {
  const errors: Record<string, any> = {};
  for (const collection of collections) {
    try {
      await global.db.runCommand({
        collMod: collection,
        validationLevel: validationLevel,
      });
    } catch (err) {
      errors[collection] = err;
    }
  }
  return { errors };
}
