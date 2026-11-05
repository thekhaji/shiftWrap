// At most one branch is Taksim Express and one is Troy Express; other branches order products from one of them.
export enum ExpressType {
    TAKSIM = 'TAKSIM',
    TROY = 'TROY',
}

// NEW: placed -> ASSIGNED: an employee of the Express branch is responsible -> SENT: they sent it
// -> RECEIVED: the ordering branch confirmed the quantities the next day
export enum ExpressOrderStatus {
    NEW = 'NEW',
    ASSIGNED = 'ASSIGNED',
    SENT = 'SENT',
    RECEIVED = 'RECEIVED',
}
