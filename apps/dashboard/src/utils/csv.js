import { formatExportDate } from "./format.js";

function csvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

/**
 * Construit un export CSV (compatible Excel via BOM UTF-8) des prospects.
 * Reste indépendant du DOM : peut être testé isolément.
 */
export function buildProspectsCsv(prospects = []) {
  const customFields = [
    ...new Set(
      prospects.flatMap((prospect) => {
        const data = prospect.prospectLeads?.[0]?.leadData ?? prospect.leadData;
        return data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [];
      }),
    ),
  ].sort();

  const headers = [
    "Nom",
    "WhatsApp",
    "Date de début",
    "Dernière activité",
    "Qualification",
    "Score",
    "Statut lead",
    "Routage",
    "Routé",
    "Date routage",
    "Ville",
    "Besoin",
    "Budget",
    "Produit",
    "Urgence",
    "Zone",
    "Commercial",
    ...customFields.map((field) => `Champ: ${field}`),
  ];

  const rows = prospects.map((prospect) => {
    const lead = prospect.prospectLeads?.[0] ?? {};
    const data =
      lead.leadData && typeof lead.leadData === "object" && !Array.isArray(lead.leadData)
        ? lead.leadData
        : prospect.leadData && typeof prospect.leadData === "object" && !Array.isArray(prospect.leadData)
          ? prospect.leadData
          : {};

    const values = [
      lead.contactName ?? prospect.contact?.displayName ?? "",
      lead.whatsappNumber ?? prospect.contact?.whatsappJid ?? "",
      formatExportDate(prospect.createdAt),
      formatExportDate(prospect.updatedAt),
      prospect.qualificationStatus,
      prospect.leadScore ?? lead.leadScore ?? "",
      lead.status ?? "",
      lead.routeStatus ?? "",
      lead.isRouted ? "Oui" : "Non",
      formatExportDate(lead.routedAt),
      lead.city ?? data.city ?? "",
      lead.need ?? data.need ?? "",
      lead.budget ?? data.budget ?? "",
      lead.product ?? data.product ?? "",
      lead.urgency ?? data.urgency ?? "",
      lead.location?.name ?? "",
      lead.responsible?.name ?? "",
      ...customFields.map((field) => data[field] ?? ""),
    ];

    return values.map(csvValue).join(";");
  });

  return `\uFEFF${headers.map(csvValue).join(";")}\r\n${rows.join("\r\n")}`;
}

export function downloadCsv(csvContent, filename) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
