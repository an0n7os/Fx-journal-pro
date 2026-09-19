$code = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class ImageProcessor {
    public static void RemoveBlack(string inFile, string outFile) {
        Bitmap bmp = new Bitmap(inFile);
        Bitmap outBmp = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format32bppArgb);
        
        BitmapData bmpData = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        BitmapData outData = outBmp.LockBits(new Rectangle(0, 0, outBmp.Width, outBmp.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        
        int bytes = Math.Abs(bmpData.Stride) * bmp.Height;
        byte[] rgbValues = new byte[bytes];
        Marshal.Copy(bmpData.Scan0, rgbValues, 0, bytes);
        
        for (int counter = 0; counter < rgbValues.Length; counter += 4) {
            byte b = rgbValues[counter];
            byte g = rgbValues[counter + 1];
            byte r = rgbValues[counter + 2];
            // if dark (tolerance up to 25)
            if (r < 25 && g < 25 && b < 25) {
                rgbValues[counter + 3] = 0; // alpha = 0
            } else {
                rgbValues[counter + 3] = 255; // alpha = 255
            }
        }
        
        Marshal.Copy(rgbValues, 0, outData.Scan0, bytes);
        bmp.UnlockBits(bmpData);
        outBmp.UnlockBits(outData);
        
        outBmp.Save(outFile, ImageFormat.Png);
        bmp.Dispose();
        outBmp.Dispose();
    }
}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
[ImageProcessor]::RemoveBlack("$PWD\public\cartoon_flame.jpg", "$PWD\public\cartoon_flame.png")
