import * as bcrypt from 'bcrypt';
import { PrismaService } from '@config/prisma.service';
import {
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { IPagination } from '@common/interfaces/pagination.dto';
import { ConfigService } from '@nestjs/config';
import { UserDto } from './dtos/user.dto';
import { v4 as uuid } from 'uuid';
import { SesService } from '@aws/ses.service';
import welcomeHtml from '../mail/welcome.html';
import recoveryHtml from '../mail/recovery.html';
import { ResetPasswordDto } from './dtos/reset-password.dto';

@Injectable()
export class UserService {
    private salt: string;

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
        private ses: SesService
    ) {
        this.salt = bcrypt.genSaltSync(
            Number(this.configService.get<string>('SALT'))
        );
    }

    private async exists(where: Prisma.UserWhereUniqueInput) {
        return (await this.prisma.user.findUnique({ where })) !== null;
    }

    async findOne(
        where: Prisma.UserWhereUniqueInput,
        isPrivate = true
    ): Promise<UserDto | User> {
        const user = await this.prisma.user
            .findUniqueOrThrow({ where })
            .catch(() => {
                throw new NotFoundException('User not found');
            });

        return isPrivate ? UserDto.toDto(user) : user;
    }

    async create(data: Prisma.UserCreateInput) {
        if (await this.exists({ email: data.email }))
            throw new ConflictException('User already exists');

        const hashedPwd = await bcrypt.hash(data.password, this.salt);

        const user = await this.prisma.user.create({
            data: {
                ...data,
                password: hashedPwd,
                cart:
                    !data.role || data.role === Role.CLIENT
                        ? {
                              create: {},
                          }
                        : undefined,
            },
        });

        await this.ses.sendEmail({
            htmlTemplate: welcomeHtml,
            subject: 'Welcome!',
            textReplacer: (data) => data.replace('{USERNAME}', user.name),
            toAddresses: [user.email],
        });

        return UserDto.toDto(user);
    }

    async findAll(
        params: IPagination & {
            cursor?: Prisma.UserWhereUniqueInput;
            where?: Prisma.UserWhereInput;
            orderBy?: Prisma.UserOrderByWithAggregationInput;
        }
    ): Promise<UserDto[]> {
        const { page, limit, cursor, where, orderBy } = params;

        return await this.prisma.user.findMany({
            skip: Number(page) - 1,
            take: Number(limit),
            cursor,
            where,
            select: {
                id: true,
                name: true,
                lastname: true,
                username: true,
                email: true,
                recovery: true,
                role: true,
            },
            orderBy,
        });
    }

    async update(
        userId: number,
        data: Prisma.UserUpdateInput
    ): Promise<UserDto> {
        if (!(await this.exists({ id: userId })))
            throw new NotFoundException('User not found');

        const user = await this.prisma.user.update({
            data: {
                ...data,
                password: data.password
                    ? await bcrypt.hash(data.password as string, this.salt)
                    : undefined,
            },
            where: {
                id: userId,
            },
        });

        return UserDto.toDto(user);
    }

    async delete(userId: number): Promise<UserDto> {
        if (!(await this.exists({ id: userId })))
            throw new NotFoundException('User not found');

        const user = await this.prisma.user.delete({ where: { id: userId } });

        return UserDto.toDto(user);
    }

    async resetRequest(email: string) {
        let user = await this.findOne({
            email,
        });

        const token = uuid();

        user = await this.prisma.user.update({
            where: {
                email,
            },
            data: {
                recovery: token,
            },
        });

        await this.ses.sendEmail({
            htmlTemplate: recoveryHtml,
            subject: 'Reset your password',
            textReplacer: (data) =>
                data.replace(
                    '{LINK}',
                    `${this.configService.get<string>(
                        'HOST'
                    )}/auth/reset/${token}`
                ),
            toAddresses: [user.email],
        });

        return user;
    }

    async resetHandler(data: ResetPasswordDto, token: string) {
        try {
            let user = await this.findOne({ recovery: token });

            user = await this.update(user.id, {
                password: data.password,
                recovery: null,
            });

            await this.ses.sendEmail({
                htmlTemplate: recoveryHtml,
                subject: 'Your password has been reset',
                textReplacer: (data) => data.replace('{USERNAME}', user.name),
                toAddresses: [user.email],
            });

            return user;
        } catch (_) {
            throw new ForbiddenException('Token is invalid');
        }
    }
}
