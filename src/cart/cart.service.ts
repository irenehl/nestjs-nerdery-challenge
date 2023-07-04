import { PrismaService } from '@config/prisma.service';
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { AddProductToCartDto } from './dtos/add-product.dto';
import { CartDto } from './dtos/cart.dto';
import { ProductService } from '@product/product.service';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class CartService {
    constructor(
        private prisma: PrismaService,
        private productService: ProductService
    ) {}

    async findOne(userId: number): Promise<CartDto> {
        return plainToInstance(
            CartDto,
            await this.prisma.cart
                .findFirstOrThrow({
                    where: { userId },
                    include: {
                        products: {
                            select: {
                                product: true,
                                quantity: true,
                            },
                        },
                    },
                })
                .catch(() => {
                    throw new NotFoundException('Cart not found');
                })
        );
    }

    async addProduct(
        userId: number,
        data: AddProductToCartDto
    ): Promise<CartDto> {
        if (!(await this.productService.isAvailable(data.SKU, data.quantity)))
            throw new BadRequestException('Quantity exceeds current stock');

        const cart = await this.findOne(userId);

        await this.prisma.productsOnCarts.upsert({
            where: {
                cartId_productSKU: {
                    cartId: cart.id,
                    productSKU: data.SKU,
                },
            },
            create: {
                productSKU: data.SKU,
                quantity: data.quantity,
                cartId: cart.id,
            },
            update: {
                quantity: data.quantity,
            },
            select: {
                product: true,
                quantity: true,
            },
        });

        return plainToInstance(CartDto, await this.findOne(cart.userId));
    }

    // This returns the updated cart, that's the reason why it doesn't return void
    async deleteProductOnCart(userId: number, SKU: number): Promise<CartDto> {
        const cart = await this.findOne(userId);

        await this.prisma.productsOnCarts
            .findUniqueOrThrow({
                where: {
                    cartId_productSKU: {
                        productSKU: SKU,
                        cartId: cart.id,
                    },
                },
            })
            .catch(() => {
                throw new NotFoundException(
                    `Product ${SKU} is not in this cart`
                );
            });

        await this.prisma.productsOnCarts.delete({
            where: {
                cartId_productSKU: {
                    productSKU: SKU,
                    cartId: cart.id,
                },
            },
            select: {
                product: true,
                quantity: true,
            },
        });

        return plainToInstance(CartDto, await this.findOne(cart.userId));
    }
}
