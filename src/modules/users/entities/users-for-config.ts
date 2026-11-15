export class UserForConfigEntity {
    public trojanPassword: string;
    public vlessUuid: string;
    public ssPassword: string;
    public mtprotoSecret: null | string;
    public mtprotoAdTag: null | string;
    public tags: string[];
    public id: bigint;

    constructor(data: UserForConfigEntity) {
        this.trojanPassword = data.trojanPassword;
        this.vlessUuid = data.vlessUuid;
        this.ssPassword = data.ssPassword;
        this.mtprotoSecret = data.mtprotoSecret;
        this.mtprotoAdTag = data.mtprotoAdTag;
        this.tags = data.tags;
        this.id = data.id;
    }
}
