export interface PlazaCreator {
    name: string;
    desc: string;
    tag: 'official' | 'creator' | 'vup' | 'oc';
    tier?: 'gold' | 'silver';
    site: string;
}

export const PLAZA_CREATORS: PlazaCreator[] = [];
