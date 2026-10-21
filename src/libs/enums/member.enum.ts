export enum MemberType{
    USER = 'USER',
    MANAGER = 'MANAGER',
    BOSS = 'BOSS',
    ADMIN = 'ADMIN',
}

export enum MemberStatus{
    PENDING = 'PENDING',   // registered, waiting for the branch manager to confirm
    ACTIVE = 'ACTIVE',
    BLOCK = 'BLOCK',
    INACTIVE = 'INACTIVE'
}