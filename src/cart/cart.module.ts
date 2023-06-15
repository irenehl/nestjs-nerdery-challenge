import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { PrismaService } from '@config/prisma.service';
import { ProductService } from '@product/product.service';
import { AwsModule } from 'src/aws/aws.module';
import { S3Service } from 'src/aws/s3.service';
import { ConfigService } from '@nestjs/config';

@Module({
    imports: [AwsModule],
    providers: [
        CartService,
        PrismaService,
        ProductService,
        S3Service,
        ConfigService,
    ],
    controllers: [CartController],
})
export class CartModule {}
