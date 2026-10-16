export enum CleaningPlace {
    SALON = 'SALON',
    KITCHEN = 'KITCHEN',
    PREP = 'PREP',
    OFFICE = 'OFFICE',
}

export const CLEANING_PLACE_LABELS: Record<CleaningPlace, string> = {
    SALON: '🛋 Zal',
    KITCHEN: '🍳 Oshxona',
    PREP: '🥬 Tayyorlov hududi',
    OFFICE: '🗄 Ofis',
};

// plain text for slides/captions (no emoji)
export const CLEANING_PLACE_NAMES: Record<CleaningPlace, string> = {
    SALON: 'Zal',
    KITCHEN: 'Oshxona',
    PREP: 'Tayyorlov hududi',
    OFFICE: 'Ofis',
};

// used in the Turkish message that goes to the group
export const CLEANING_PLACE_NAMES_TR: Record<CleaningPlace, string> = {
    SALON: 'Salon',
    KITCHEN: 'Mutfak',
    PREP: 'Hazırlık alanı',
    OFFICE: 'Ofis',
};
