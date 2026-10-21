export enum HttpCode{
    OK = 200,
    CREATED = 201,
    NOT_MODIFIED = 400,
    BAD_REQUEST = 400,
    UNATHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    INTERNAL_SERVER_ERROR = 500,
    CONFLICT = 409,
}

export enum Message{
    NO_BRANCH_NEARBY = "No branch found near you!",
    TOO_FAR = "You are too far from any branch!",
    NO_RATE_SET = "No rate has been set!",
    EXISTING_BRANCH = "A branch with that name already exists!",
    ALREADY_CHECKED_IN = "You have already checked in!",
    NO_OPEN_SHIFT = "You have no open shift!",
    SOMETHING_WENT_RONG = "Something Went Wrong!",
    NO_DATA_FOUND = "No data is found!",
    CREATE_FAILED = "Create is failed!",
    UPDATE_FAILED = "Update is failed!",
    EXISTING_USER = "You are already registered!",
    NO_MEMBER_NICK = "No member with that member nick!",
    WRONG_PASSWORD = "Wrong password inserted!",
    NOT_AUTHENTICATED = "You are not authenticated, Please login first",
    BLOCKED_USER = "You have been blocked, contact admin!",
    TOKEN_CREATION_FAILED = "Token creation error!",
    ORDER_NOT_FOUND = "Order not found!",
    EXISTING_PRODUCT = "A product with that name already exists!",
    MANAGER_LIMIT = "A branch can have at most 2 managers!",
}

class Errors extends Error{
    public code: HttpCode;
    public message: Message;

    static standard = {
        code: HttpCode.INTERNAL_SERVER_ERROR,
        message: Message.SOMETHING_WENT_RONG,
    }

    constructor(statusCode: HttpCode, statusMessage: Message){
        super();
        this.code = statusCode;
        this.message = statusMessage;
    }

}

export default Errors;