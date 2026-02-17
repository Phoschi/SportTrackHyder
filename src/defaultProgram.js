export const DEFAULT_PROGRAM = {
  version: 1,
  weeks: {
    odd: {
      lundi: [
        { id: "poulie_h", name: "Poulie Haute Ext.", sets: 4, range: "10-15" },
        { id: "poulie_b", name: "Poulie Basse Ext.", sets: 4, range: "10-15" },
        { id: "dev_halt", name: "Dev. Haltères (Pecs)", sets: 3, range: "8-15" },
        { id: "dev_smith", name: "Dev. Smith (Pecs)", sets: 3, range: "8-15" },
        { id: "ecarte", name: "Écarté Poulie", sets: 4, range: "12-20" }
      ],
      mardi: [
        { id: "presse", name: "Presse à Cuisses", sets: 4, range: "8-15" },
        { id: "leg_ext", name: "Leg Extension Assis", sets: 4, range: "8-15" },
        { id: "add_ext", name: "Adducteur Externe", sets: 4, range: "12-20" },
        { id: "add_int", name: "Adducteur Interne", sets: 4, range: "12-20" },
        { id: "mollets", name: "Mollets", sets: 4, range: "15-25" }
      ],
      mercredi: [{ id: "abdos_1", name: "Routine Abdos", type: "static" }],
      jeudi: [
        { id: "pullover", name: "Pull-over", sets: 4, range: "10-20" },
        { id: "tir_vert", name: "Tirage Vert. Serré", sets: 4, range: "8-15" },
        { id: "tir_horiz", name: "Tirage Horizontal", sets: 4, range: "8-15" },
        { id: "curl_inc", name: "Curl Incliné", sets: 4, range: "8-15" },
        { id: "curl_mart", name: "Curl Marteau Assis", sets: 4, range: "8-15" }
      ],
      vendredi: [
        { id: "dev_mili", name: "Dev. Militaire Smith", sets: 3, range: "8-15" },
        { id: "elev_lat", name: "Élévations Latérales", sets: 4, range: "15-25" },
        { id: "arriere_ep", name: "Arrière d'Épaules", sets: 4, range: "20-30" },
        { id: "tri_uni", name: "Triceps Unilatéral", sets: 5, range: "10-15" },
        { id: "abdos_2", name: "Routine Abdos", type: "static" }
      ],
      dimanche: [
        { id: "sdt_r", name: "Deadlift Roumain", sets: 4, range: "8-15" },
        { id: "releve_buste", name: "Relevé Buste Lomb.", sets: 4, range: "8-15" },
        { id: "curl_assis", name: "Curl Biceps Assis", sets: 4, range: "8-15" },
        { id: "abdos_3", name: "Routine Abdos", type: "static" }
      ]
    },
    even: {
      lundi: [
        { id: "poulie_h", name: "Poulie Haute Ext.", sets: 4, range: "10-15" },
        { id: "poulie_b", name: "Poulie Basse Ext.", sets: 4, range: "10-15" },
        { id: "dev_halt", name: "Dev. Haltères (Pecs)", sets: 3, range: "8-15" },
        { id: "dev_smith", name: "Dev. Smith (Pecs)", sets: 3, range: "8-15" },
        { id: "ecarte", name: "Écarté Poulie", sets: 4, range: "12-20" }
      ],
      mardi: [
        { id: "presse", name: "Presse à Cuisses", sets: 4, range: "8-15" },
        { id: "leg_curl", name: "Leg Curl Assis", sets: 4, range: "8-15" },
        { id: "add_ext", name: "Adducteur Externe", sets: 4, range: "12-20" },
        { id: "add_int", name: "Adducteur Interne", sets: 4, range: "12-20" },
        { id: "mollets", name: "Mollets", sets: 4, range: "15-25" }
      ],
      mercredi: [{ id: "abdos_1", name: "Routine Abdos", type: "static" }],
      jeudi: [
        { id: "pullover", name: "Pull-over", sets: 4, range: "10-20" },
        { id: "tir_vert", name: "Tirage Vert. Serré", sets: 4, range: "8-15" },
        { id: "tir_horiz", name: "Tirage Horizontal", sets: 4, range: "8-15" },
        { id: "curl_inc", name: "Curl Incliné", sets: 4, range: "8-15" },
        { id: "curl_mart", name: "Curl Marteau Assis", sets: 4, range: "8-15" }
      ],
      vendredi: [
        { id: "dev_mili", name: "Dev. Militaire Smith", sets: 3, range: "8-15" },
        { id: "elev_lat", name: "Élévations Latérales", sets: 4, range: "15-25" },
        { id: "arriere_ep", name: "Arrière d'Épaules", sets: 4, range: "20-30" },
        { id: "tri_uni", name: "Triceps Unilatéral", sets: 5, range: "10-15" },
        { id: "abdos_2", name: "Routine Abdos", type: "static" }
      ],
      dimanche: [
        { id: "sdt_r", name: "Deadlift Roumain", sets: 4, range: "8-15" },
        { id: "releve_buste", name: "Relevé Buste Lomb.", sets: 4, range: "8-15" },
        { id: "curl_assis", name: "Curl Biceps Assis", sets: 4, range: "8-15" },
        { id: "abdos_3", name: "Routine Abdos", type: "static" }
      ]
    }
  }
};

export function cloneDefaultProgram() {
  if (typeof structuredClone === "function") return structuredClone(DEFAULT_PROGRAM);
  return JSON.parse(JSON.stringify(DEFAULT_PROGRAM));
}

