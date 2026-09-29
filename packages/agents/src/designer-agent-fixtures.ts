/**
 * ثوابت اختبار DesignerAgent — الدفعة السليمة المرجعية وأداة JSON.
 * مفصولة عن ملف الاختبار للحفاظ على حدود الملفات؛ لا منطق هنا.
 */

/** الدفعة السليمة المرجعية لأدوات petstore الأربع المرشحة */
export const VALID_BATCH = {
  designs: [
    {
      name: "list_pets",
      description: "List all pets in the store with an optional result limit.",
      endpointIds: ["listPets"],
      parameters: {
        limit: { type: "number", required: false, description: "Max pets to return." },
      },
    },
    {
      name: "create_pet",
      description: "Create a new pet record with a required name.",
      endpointIds: ["createPet"],
      parameters: {
        name: { type: "string", required: true, description: "Name of the new pet." },
        tag: { type: "string", required: false, description: "Optional tag." },
      },
    },
    {
      name: "get_pet_by_id",
      description: "Retrieve one pet by its unique identifier.",
      endpointIds: ["showPetById"],
      parameters: {
        petId: { type: "string", required: true, description: "Pet identifier." },
      },
    },
    {
      name: "delete_pet",
      description: "Remove a pet permanently by its identifier.",
      endpointIds: ["deletePet"],
      parameters: {
        petId: { type: "string", required: true, description: "Pet identifier." },
      },
    },
  ],
} as const;

export const json = (value: unknown): string => JSON.stringify(value);
