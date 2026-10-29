export enum MemberType{
    USER = 'USER',
    MANAGER = 'MANAGER',
    BOSS = 'BOSS',
    ADMIN = 'ADMIN',
}

// A branch has one MAIN manager and one ASSISTANT. A manager without a role (created before
// assistants existed) counts as MAIN.
export enum ManagerRole{
    MAIN = 'MAIN',
    ASSISTANT = 'ASSISTANT',
}

export enum MemberStatus{
    PENDING = 'PENDING',   // registered, waiting for the branch manager to confirm
    ACTIVE = 'ACTIVE',
    BLOCK = 'BLOCK',
    INACTIVE = 'INACTIVE'
}