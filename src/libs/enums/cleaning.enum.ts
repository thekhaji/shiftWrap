export enum CleaningPlace {
    SALON = 'SALON',
    KITCHEN = 'KITCHEN',
    PREP = 'PREP',
    OFFICE = 'OFFICE',
    HOME = 'HOME',
}

// plain text for slides/captions (no emoji)
export const CLEANING_PLACE_NAMES: Record<CleaningPlace, string> = {
    SALON: 'Zal',
    KITCHEN: 'Oshxona',
    PREP: 'Tayyorlov hududi',
    OFFICE: 'Ofis',
    HOME: 'Uy',
};

// used in the Turkish message that goes to the group
export const CLEANING_PLACE_NAMES_TR: Record<CleaningPlace, string> = {
    SALON: 'Salon',
    KITCHEN: 'Mutfak',
    PREP: 'Hazırlık alanı',
    OFFICE: 'Ofis',
    HOME: 'Ev',
};

// The manager reviews Office and Home on their own; these three go into one deck,
// each slide headed with its place. Employees still upload every place separately.
export const CLEANING_OTHERS: CleaningPlace[] = [CleaningPlace.SALON, CleaningPlace.KITCHEN, CleaningPlace.PREP];
export const CLEANING_SEPARATE: CleaningPlace[] = [CleaningPlace.OFFICE, CleaningPlace.HOME];
export const CLEANING_OTHERS_KEY = 'OTHERS';   // callback token for the combined deck
